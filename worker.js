const PRISONER_BASE = "https://scum.theprisonerbot.com/api";
const GS4U_URL = "https://www.gs4u.net/de/s/436818";
const GAMEMONITORING_BASE = "https://api.gamemonitoring.net";
const GAMEMONITORING_SERVER_ID = "13954416";

const PUBLIC_SERVER = {
  name: "Shadow Forge",
  connectAddress: "176.57.174.127:28202",
  maxPlayers: 60,
  map: "Island Map"
};

const PATHS = {
  server: "/server",
  players: "/players",
  kills: "/leaderboard/kills",
  playtime: "/leaderboard/playtime"
};

const LIVE_CACHE_MS = 5_000;
const LEADERBOARD_CACHE_MS = 30_000;

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=UTF-8",
    ...extra
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(extraHeaders) });
}

function isObject(v) { return v && typeof v === "object" && !Array.isArray(v); }

function findArray(value, preferred = [], depth = 0) {
  if (depth > 8 || value == null) return null;
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return null;
  for (const key of preferred) if (Array.isArray(value[key])) return value[key];
  const common = ["players", "onlinePlayers", "online_players", "leaderboard", "rankings", "items", "results", "rows", "data", "entries", "records"];
  for (const key of common) if (Array.isArray(value[key])) return value[key];
  for (const key of Object.keys(value)) {
    const found = findArray(value[key], preferred, depth + 1);
    if (found) return found;
  }
  return null;
}

function findValueByKey(value, keys, depth = 0) {
  if (depth > 10 || value == null) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValueByKey(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  const wanted = new Set(keys.map(k => String(k).toLowerCase()));
  for (const [key, val] of Object.entries(value)) if (wanted.has(key.toLowerCase())) return val;
  for (const val of Object.values(value)) {
    const found = findValueByKey(val, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizeServer(data) {
  const root = data?.response ?? data;
  const players = numeric(root?.numplayers ?? root?.players ?? root?.playersOnline ?? root?.onlinePlayers ?? root?.playerCount ?? root?.currentPlayers);
  const onlineValue = root?.status ?? root?.online ?? root?.isOnline ?? root?.serverOnline;
  const version = root?.version ?? root?.serverVersion;
  return {
    online: typeof onlineValue === "boolean" ? onlineValue : true,
    players,
    maxPlayers: PUBLIC_SERVER.maxPlayers,
    version: typeof version === "string" ? version : null,
    map: PUBLIC_SERVER.map,
    ping: null
  };
}

function normalizePlayers(data) {
  const root = data?.response ?? data;
  const arr = findArray(root, ["players", "onlinePlayers", "online_players", "items", "entries", "records", "rows", "data", "results"]);
  if (!arr) return [];
  return arr.map((p, index) => {
    if (!isObject(p)) return { id: index + 1, name: String(p), ping: null };
    return {
      id: index + 1,
      name: p.name ?? p.playerName ?? p.player_name ?? p.displayName ?? p.username ?? p.nickname ?? "Unknown Survivor",
      ping: numeric(p.ping)
    };
  });
}

function normalizeLeaderboard(data, kind) {
  const root = data?.response ?? data;
  const arr = findArray(root, ["leaderboard", "rankings", kind, "entries", "players", "items", "data"]) || [];
  return arr.map((item, index) => {
    if (!isObject(item)) return { rank: index + 1, name: String(item), value: null };
    let value = kind === "kills"
      ? item.kills ?? item.totalKills ?? item.killCount ?? item.killsCount ?? item.value ?? item.score ?? null
      : item.playtime ?? item.playTime ?? item.totalPlaytime ?? item.total_playtime ?? item.hours ?? item.minutes ?? item.value ?? null;
    if (typeof value === "object" && value !== null) {
      value = value.formatted ?? value.hours ?? value.minutes ?? value.total ?? value.value ?? null;
    }
    return {
      rank: item.rank ?? item.position ?? index + 1,
      name: item.name ?? item.player ?? item.playerName ?? item.player_name ?? item.displayName ?? item.username ?? item.steamName ?? "Unknown Survivor",
      value
    };
  });
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}

async function fetchJsonUrl(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 5, cacheEverything: false }
    });
    return {
      ok: response.ok,
      status: response.status,
      responseMs: Date.now() - started,
      data: await readJson(response),
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      responseMs: Date.now() - started,
      data: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function gameMonitoringFetch() {
  const serverUrl = `${GAMEMONITORING_BASE}/servers/${GAMEMONITORING_SERVER_ID}`;
  const playersUrl = `${serverUrl}/players?limit=${PUBLIC_SERVER.maxPlayers}`;
  const started = Date.now();
  const [server, players] = await Promise.all([
    fetchJsonUrl(serverUrl),
    fetchJsonUrl(playersUrl)
  ]);
  return {
    ok: server.ok,
    configured: true,
    responseMs: Date.now() - started,
    server: server.ok ? normalizeServer(server.data) : null,
    players: players.ok ? normalizePlayers(players.data) : [],
    playersOk: players.ok,
    serverStatus: server.status,
    playersStatus: players.status,
    error: server.ok ? null : server.error
  };
}

async function prisonerFetch(env, path) {
  if (!env.PRISONER_API_TOKEN) return { ok: false, status: 503, responseMs: 0, data: null, error: "Prisoner Bot not configured" };
  const started = Date.now();
  try {
    const response = await fetch(new URL(path, PRISONER_BASE), {
      headers: { Accept: "application/json", "PRISONER-BOT-TOKEN": env.PRISONER_API_TOKEN },
      cf: { cacheTtl: 5, cacheEverything: false }
    });
    return {
      ok: response.ok,
      status: response.status,
      responseMs: Date.now() - started,
      data: await readJson(response),
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    return { ok: false, status: 502, responseMs: Date.now() - started, data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function gs4uFetch() {
  const started = Date.now();
  try {
    const response = await fetch(GS4U_URL, {
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "ShadowForge-Live/3.0" },
      cf: { cacheTtl: 10, cacheEverything: false }
    });
    const html = await response.text();
    const text = cleanText(html);
    const online = /Status:\s*Online/i.test(text);
    const playersMatch = text.match(/Spieler:\s*(\d+)\s*von\s*(\d+)/i);
    const players = playersMatch ? Number(playersMatch[1]) : null;
    return {
      ok: response.ok,
      responseMs: Date.now() - started,
      server: { online, players, maxPlayers: PUBLIC_SERVER.maxPlayers }
    };
  } catch (error) {
    return { ok: false, responseMs: Date.now() - started, server: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function cachedJson(key, loader, ttl) {
  const cache = caches.default;
  const cacheKey = new Request(`https://shadow-forge-cache.invalid/${key}`);
  const hit = await cache.match(cacheKey);
  if (hit) {
    const stored = Number(hit.headers.get("X-SF-Stored") || 0);
    if (stored && Date.now() - stored < ttl) return new Response(hit.body, hit);
  }
  const response = json(await loader());
  const headers = new Headers(response.headers);
  headers.set("X-SF-Stored", String(Date.now()));
  const stored = new Response(response.body, { status: 200, headers });
  await cache.put(cacheKey, stored.clone());
  return stored;
}

function extractOnlinePlayers(data) {
  const root = data?.response ?? data;
  const arr = findArray(root, ["onlinePlayers", "online_players", "players", "items", "entries", "records", "rows", "data", "results"]);
  if (!arr) return [];
  const online = arr.filter((p) => {
    if (!isObject(p)) return true;
    const flag = p.online ?? p.isOnline ?? p.connected ?? p.isConnected;
    if (typeof flag === "boolean") return flag;
    const status = String(p.status ?? p.state ?? "").toLowerCase();
    if (status) return ["online", "connected", "playing", "active"].includes(status);
    return true;
  });
  return online.map((p, index) => {
    if (!isObject(p)) return { id: index + 1, name: String(p), ping: null };
    return {
      id: p.id ?? p.steamId ?? p.steam_id ?? index + 1,
      name: p.name ?? p.playerName ?? p.player_name ?? p.displayName ?? p.username ?? p.nickname ?? p.steamName ?? "Unknown Survivor",
      ping: numeric(p.ping)
    };
  });
}

function mergeLive(gm, gs4u, prisonerServer, prisonerPlayers, kills, playtime) {
  const pServer = prisonerServer?.ok ? normalizeServer(prisonerServer.data) : null;
  const pPlayers = prisonerPlayers?.ok ? extractOnlinePlayers(prisonerPlayers.data) : [];
  const gmServer = gm?.ok ? gm.server : null;
  const gmPlayers = gm?.players ?? [];
  const gServer = gs4u?.ok ? gs4u.server : null;

  // Prisoner Bot is the preferred live source because it is connected to Shadow Forge's
  // actual SCUM server through its monitoring/RCON stack. GAMEMONITORING and GS4u remain
  // independent fallbacks and sanity checks.
  const countCandidates = [
    { source: "Prisoner Bot", value: numeric(pServer?.players), priority: 1 },
    { source: "Prisoner Bot Players", value: pPlayers.length || null, priority: 1 },
    { source: "GAMEMONITORING Players", value: gm?.playersOk ? gmPlayers.length : null, priority: 2 },
    { source: "GAMEMONITORING", value: numeric(gmServer?.players), priority: 3 },
    { source: "GS4u", value: numeric(gServer?.players), priority: 4 }
  ].filter(item => Number.isFinite(item.value));

  const prisonerCandidates = countCandidates.filter(item => item.priority === 1);
  const currentPlayers = prisonerCandidates.length
    ? Math.max(...prisonerCandidates.map(item => item.value))
    : countCandidates.length
      ? Math.max(...countCandidates.map(item => item.value))
      : null;

  const countSource = countCandidates
    .filter(item => item.value === currentPlayers && item.priority === (prisonerCandidates.length ? 1 : Math.min(...countCandidates.map(x => x.priority))))
    .map(item => item.source);

  const version = gmServer?.version || pServer?.version || null;
  const ping = numeric(gm?.responseMs);
  const playerList = pPlayers.length ? pPlayers : (gm?.playersOk ? gmPlayers : []);
  const playerListSource = pPlayers.length ? "Prisoner Bot Public API" : (gm?.playersOk && gmPlayers.length ? "GAMEMONITORING" : "Keine Live-Namensquelle");

  const online = pServer?.online === true
    ? true
    : gmServer?.online === true
      ? true
      : gServer?.online === true;

  return {
    online,
    hostname: PUBLIC_SERVER.name,
    players: currentPlayers,
    maxPlayers: PUBLIC_SERVER.maxPlayers,
    version,
    map: PUBLIC_SERVER.map,
    ping,
    pingLabel: "Monitor Ping",
    playerList,
    playerListSource,
    liveSource: currentPlayers != null
      ? `Prisoner Bot${countSource.length ? ` (${countSource.join(" + ")})` : ""}`
      : "Nicht verfügbar",
    countSources: countCandidates.map(({ source, value }) => ({ source, value })),
    diagnostics: {
      prisonerBotServerPlayers: numeric(pServer?.players),
      prisonerBotPlayersCount: pPlayers.length,
      prisonerBotServerOnline: pServer?.online ?? null,
      prisonerBotConfigured: Boolean(prisonerServer?.ok || prisonerPlayers?.ok || kills?.ok || playtime?.ok),
      prisonerBotServerStatus: prisonerServer?.status ?? null,
      prisonerBotPlayersStatus: prisonerPlayers?.status ?? null,
      prisonerBotServerError: prisonerServer?.error ?? null,
      prisonerBotPlayersError: prisonerPlayers?.error ?? null
    },
    leaderboards: {
      kills: kills?.ok ? normalizeLeaderboard(kills.data, "kills") : [],
      playtime: playtime?.ok ? normalizeLeaderboard(playtime.data, "playtime") : []
    }
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    if (url.pathname === "/api/config") {
      return json({
        ok: true,
        discordUrl: env.DISCORD_URL || "https://discord.gg/XDsAjmSFhq"
      });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "shadow-forge-live-api-v3.3-prisoner-primary",
        timestamp: new Date().toISOString(),
        integrations: {
          gameMonitoring: true,
          gameMonitoringServerId: GAMEMONITORING_SERVER_ID,
          prisonerBot: Boolean(env.PRISONER_API_TOKEN),
          gs4uLiveFallback: true
        }
      });
    }

    if (url.pathname === "/api/live") {
      return cachedJson("live-v3", async () => {
        const started = Date.now();
        const [gm, gs4u, prisonerServer, prisonerPlayers, kills, playtime] = await Promise.all([
          gameMonitoringFetch(),
          gs4uFetch(),
          prisonerFetch(env, PATHS.server),
          prisonerFetch(env, PATHS.players),
          prisonerFetch(env, PATHS.kills),
          prisonerFetch(env, PATHS.playtime)
        ]);
        const server = mergeLive(gm, gs4u, prisonerServer, prisonerPlayers, kills, playtime);
        return {
          ok: Boolean(gm.ok || gs4u.ok || prisonerServer.ok || prisonerPlayers.ok),
          timestamp: new Date().toISOString(),
          responseMs: Date.now() - started,
          server,
          sources: {
            gameMonitoring: { ok: Boolean(gm.ok), playersOk: Boolean(gm.playersOk), responseMs: gm.responseMs },
            gs4u: Boolean(gs4u.ok),
            prisonerBot: Boolean(prisonerServer.ok || prisonerPlayers.ok || kills.ok || playtime.ok)
          }
        };
      }, LIVE_CACHE_MS);
    }

    if (url.pathname === "/api/leaderboard") {
      const kind = url.searchParams.get("type") === "playtime" ? "playtime" : "kills";
      return cachedJson(`leaderboard-${kind}`, async () => {
        const result = await prisonerFetch(env, PATHS[kind]);
        return {
          ok: result.ok,
          source: "Prisoner Bot Public API",
          type: kind,
          leaderboard: result.ok ? normalizeLeaderboard(result.data, kind) : []
        };
      }, LEADERBOARD_CACHE_MS);
    }

    if (url.pathname === "/api/query") {
      const result = await gameMonitoringFetch();
      return json({
        ok: result.ok,
        source: "GAMEMONITORING",
        server: result.server ? {
          online: result.server.online,
          players: result.server.players,
          maxPlayers: PUBLIC_SERVER.maxPlayers,
          version: result.server.version,
          map: PUBLIC_SERVER.map,
          ping: result.responseMs
        } : null,
        players: result.playersOk ? result.players : []
      });
    }

    if (url.pathname === "/api/players") {
      const [prisonerPlayers, gm] = await Promise.all([
        prisonerFetch(env, PATHS.players),
        gameMonitoringFetch()
      ]);
      const players = prisonerPlayers.ok
        ? extractOnlinePlayers(prisonerPlayers.data)
        : (gm.playersOk ? gm.players : []);
      return json({
        ok: Boolean(prisonerPlayers.ok || gm.playersOk),
        source: prisonerPlayers.ok ? "Prisoner Bot Public API" : (gm.playersOk ? "GAMEMONITORING" : "Nicht verfügbar"),
        count: players.length,
        players
      });
    }

    if (url.pathname === "/api/prisoner-status") {
      const [server, players] = await Promise.all([
        prisonerFetch(env, PATHS.server),
        prisonerFetch(env, PATHS.players)
      ]);
      const normalizedServer = server.ok ? normalizeServer(server.data) : null;
      const normalizedPlayers = players.ok ? extractOnlinePlayers(players.data) : [];
      return json({
        ok: Boolean(server.ok || players.ok),
        source: "Prisoner Bot Public API",
        configured: Boolean(env.PRISONER_API_TOKEN),
        server: {
          ok: server.ok,
          status: server.status,
          players: normalizedServer?.players ?? null,
          online: normalizedServer?.online ?? null,
          version: normalizedServer?.version ?? null,
          error: server.error ?? null
        },
        players: {
          ok: players.ok,
          status: players.status,
          count: normalizedPlayers.length,
          names: normalizedPlayers.map(p => p.name),
          error: players.error ?? null
        }
      });
    }

    if (!url.pathname.startsWith("/api/") && env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Shadow Forge Live API", { status: 404, headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=UTF-8" } });
  }
};
