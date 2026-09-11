const http = require('node:http');
const dgram = require('node:dgram');
const { URL } = require('node:url');

const HOST = process.env.SCUM_HOST || '176.57.174.127';
const QUERY_PORT = Number(process.env.SCUM_QUERY_PORT || 28215);
const BRIDGE_PORT = Number(process.env.PORT || 8787);
const BRIDGE_KEY = process.env.BRIDGE_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const TIMEOUT_MS = Number(process.env.QUERY_TIMEOUT_MS || 2500);

const A2S_HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const INFO_REQUEST = Buffer.concat([
  A2S_HEADER,
  Buffer.from([0x54]),
  Buffer.from('Source Engine Query\0', 'ascii')
]);

function readCString(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  if (end === -1) throw new Error('Invalid A2S string');
  return {
    value: buffer.toString('utf8', offset, end),
    next: end + 1
  };
}

function readUInt8(buffer, offset) {
  return { value: buffer.readUInt8(offset), next: offset + 1 };
}

function readUInt16(buffer, offset) {
  return { value: buffer.readUInt16LE(offset), next: offset + 2 };
}

function readUInt32(buffer, offset) {
  return { value: buffer.readUInt32LE(offset), next: offset + 4 };
}

function readFloat32(buffer, offset) {
  return { value: buffer.readFloatLE(offset), next: offset + 4 };
}

function parseA2SInfo(packet) {
  if (packet.length < 6) throw new Error('A2S response too short');
  if (packet.readInt32LE(0) !== -1) throw new Error('Invalid A2S header');

  const type = packet.readUInt8(4);
  if (type === 0x41) {
    if (packet.length < 9) throw new Error('A2S challenge response too short');
    return { challenge: packet.readInt32LE(5) };
  }

  if (type !== 0x49) throw new Error(`Unsupported A2S_INFO response type: 0x${type.toString(16)}`);

  let o = 5;
  let r;
  r = readUInt8(packet, o); const protocol = r.value; o = r.next;
  r = readCString(packet, o); const name = r.value; o = r.next;
  r = readCString(packet, o); const map = r.value; o = r.next;
  r = readCString(packet, o); const folder = r.value; o = r.next;
  r = readCString(packet, o); const game = r.value; o = r.next;
  r = readUInt16(packet, o); const appId = r.value; o = r.next;
  r = readUInt8(packet, o); const players = r.value; o = r.next;
  r = readUInt8(packet, o); const maxPlayers = r.value; o = r.next;
  r = readUInt8(packet, o); const bots = r.value; o = r.next;
  r = readUInt8(packet, o); const serverType = String.fromCharCode(r.value); o = r.next;
  r = readUInt8(packet, o); const environment = String.fromCharCode(r.value); o = r.next;
  r = readUInt8(packet, o); const visibility = r.value; o = r.next;
  r = readUInt8(packet, o); const vac = r.value; o = r.next;
  r = readCString(packet, o); const version = r.value; o = r.next;

  let port = null;
  let keywords = null;
  let gameId = null;

  // EDF bitmask is present in normal Source A2S_INFO responses.
  if (o < packet.length) {
    r = readUInt8(packet, o);
    const edf = r.value;
    o = r.next;

    if (edf & 0x80) {
      if (o + 2 <= packet.length) {
        r = readUInt16(packet, o);
        port = r.value;
        o = r.next;
      }
    }

    if (edf & 0x10) {
      if (o + 6 <= packet.length) o += 6; // SteamID (64-bit)
    }

    if (edf & 0x40) {
      const s = readCString(packet, o);
      keywords = s.value;
      o = s.next;
    }

    if (edf & 0x20) {
      if (o + 8 <= packet.length) {
        const low = packet.readUInt32LE(o);
        const high = packet.readUInt32LE(o + 4);
        gameId = high * 4294967296 + low;
      }
    }
  }

  return {
    protocol,
    name,
    map,
    folder,
    game,
    appId,
    players,
    maxPlayers,
    bots,
    serverType,
    environment,
    visibility,
    vac,
    version,
    port,
    keywords,
    gameId
  };
}


function parseA2SPlayer(packet) {
  if (packet.length < 5) throw new Error('A2S_PLAYER response too short');
  if (packet.readInt32LE(0) !== -1) throw new Error('Invalid A2S_PLAYER header');
  const type = packet.readUInt8(4);
  if (type === 0x41) {
    if (packet.length < 9) throw new Error('A2S_PLAYER challenge response too short');
    return { challenge: packet.readInt32LE(5) };
  }
  if (type !== 0x44) throw new Error(`Unsupported A2S_PLAYER response type: 0x${type.toString(16)}`);

  let o = 5;
  const count = packet.readUInt8(o);
  o += 1;
  const players = [];
  for (let i = 0; i < count && o < packet.length; i += 1) {
    if (o + 1 > packet.length) break;
    const index = packet.readUInt8(o);
    o += 1;
    const name = readCString(packet, o);
    o = name.next;
    if (o + 4 > packet.length) break;
    const score = packet.readInt32LE(o);
    o += 4;
    if (o + 4 > packet.length) break;
    const duration = packet.readFloatLE(o);
    o += 4;
    players.push({ index, name: name.value, score, duration });
  }
  return { count: players.length, players };
}

function queryPlayers(host, port) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let timer;
    let challenge = -1;
    let attempts = 0;

    const cleanup = () => {
      clearTimeout(timer);
      try { socket.close(); } catch {}
    };

    const send = () => {
      const challengeBuffer = Buffer.alloc(4);
      challengeBuffer.writeInt32LE(challenge, 0);
      const packet = Buffer.concat([A2S_HEADER, Buffer.from([0x55]), challengeBuffer]);
      socket.send(packet, 0, packet.length, port, host, (error) => {
        if (error) { cleanup(); reject(error); }
      });
    };

    socket.on('message', message => {
      try {
        const parsed = parseA2SPlayer(message);
        if (parsed.challenge !== undefined) {
          challenge = parsed.challenge;
          attempts += 1;
          if (attempts > 2) throw new Error('A2S_PLAYER challenge loop');
          send();
          return;
        }
        cleanup();
        resolve(parsed.players || []);
      } catch (error) { cleanup(); reject(error); }
    });

    socket.on('error', error => { cleanup(); reject(error); });
    timer = setTimeout(() => { cleanup(); reject(new Error(`A2S_PLAYER timeout after ${TIMEOUT_MS}ms`)); }, TIMEOUT_MS);
    socket.bind(0, send);
  });
}

function queryInfo(host, port) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let timer;
    let challenge = null;
    let attempts = 0;

    const cleanup = () => {
      clearTimeout(timer);
      try { socket.close(); } catch {}
    };

    const send = () => {
      const packet = challenge === null
        ? INFO_REQUEST
        : Buffer.concat([INFO_REQUEST, Buffer.from([challenge & 0xff, (challenge >> 8) & 0xff, (challenge >> 16) & 0xff, (challenge >> 24) & 0xff])]);

      socket.send(packet, 0, packet.length, port, host, (error) => {
        if (error) {
          cleanup();
          reject(error);
        }
      });
    };

    socket.on('message', (message) => {
      try {
        const parsed = parseA2SInfo(message);
        if (parsed.challenge !== undefined) {
          challenge = parsed.challenge;
          attempts += 1;
          if (attempts > 2) throw new Error('A2S challenge loop');
          send();
          return;
        }

        cleanup();
        resolve(parsed);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    socket.on('error', (error) => {
      cleanup();
      reject(error);
    });

    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`UDP query timeout after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    socket.bind(0, send);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Shadow-Forge-Key'
  });
  res.end(payload);
}

function authorized(req) {
  if (!BRIDGE_KEY) return true;
  return req.headers['x-shadow-forge-key'] === BRIDGE_KEY;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Shadow-Forge-Key'
    });
    return res.end();
  }

  if (url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'shadow-forge-scum-query-bridge',
      host: HOST,
      queryPort: QUERY_PORT,
      timestamp: new Date().toISOString()
    });
  }

  if (url.pathname !== '/query' || req.method !== 'GET') {
    return sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  if (!authorized(req)) {
    return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
  }

  const requestedHost = url.searchParams.get('host') || HOST;
  const requestedPort = Number(url.searchParams.get('port') || QUERY_PORT);

  // Never turn this into an open UDP proxy. Only the configured SCUM target is allowed.
  if (requestedHost !== HOST || requestedPort !== QUERY_PORT) {
    return sendJson(res, 403, { ok: false, error: 'Target not allowed' });
  }

  const started = Date.now();

  try {
    const info = await queryInfo(HOST, QUERY_PORT);
    let players = [];
    try { players = await queryPlayers(HOST, QUERY_PORT); } catch {}
    return sendJson(res, 200, {
      ok: true,
      source: 'SCUM A2S / Source Query',
      queriedAt: new Date().toISOString(),
      responseMs: Date.now() - started,
      server: {
        online: true,
        name: info.name,
        map: info.map,
        version: info.version,
        players: info.players,
        maxPlayers: info.maxPlayers,
        bots: info.bots,
        ping: Date.now() - started,
        queryPort: QUERY_PORT,
        gamePort: Number(process.env.SCUM_GAME_PORT || 28202),
        appId: info.appId,
        game: info.game,
        keywords: info.keywords,
        raw: info
      },
      players
    });
  } catch (error) {
    return sendJson(res, 200, {
      ok: false,
      source: 'SCUM A2S / Source Query',
      queriedAt: new Date().toISOString(),
      responseMs: Date.now() - started,
      server: {
        online: false,
        name: 'Shadow Forge',
        map: null,
        version: null,
        players: null,
        maxPlayers: null,
        ping: null,
        queryPort: QUERY_PORT,
        gamePort: Number(process.env.SCUM_GAME_PORT || 28202)
      },
      players: [],
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(BRIDGE_PORT, '0.0.0.0', () => {
  console.log(`Shadow Forge Query Bridge listening on :${BRIDGE_PORT}`);
  console.log(`SCUM target: ${HOST}:${QUERY_PORT}`);
});
