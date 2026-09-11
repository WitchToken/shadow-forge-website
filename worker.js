const PRISONER_BASE = "https://scum.theprisonerbot.com/api";
const GS4U_URL = "https://www.gs4u.net/de/s/436818";

// Publicly safe server settings. Sensitive query/infra values are read from
// Cloudflare Worker environment variables and are NEVER returned by the API.
const PUBLIC_SERVER = {
  name: "Shadow Forge",
  connectAddress: "176.57.174.127:28202",
  maxPlayersFallback: 60
};



const PATHS = {
  server: "/server",
  players: "/players",
  kills: "/leaderboard/kills",
  playtime: "/leaderboard/playtime"
};

const CACHE_TTL_MS = 10_000;

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Shadow-Forge-Key",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=UTF-8",
    ...extra
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: corsHeaders(extraHeaders)
  });
}

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function findArray(value, preferred = [], depth = 0) {
  if (depth > 8 || value == null) return null;
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return null;

  for (const key of preferred) {
    if (Array.isArray(value[key])) return value[key];
  }

  const common = ["players", "onlinePlayers", "online_players", "leaderboard", "rankings", "items", "results", "rows", "data", "entries", "records"];
  for (const key of common) {
    if (Array.isArray(value[key])) return value[key];
  }

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
  for (const [key, val] of Object.entries(value)) {
    if (wanted.has(key.toLowerCase())) return val;
  }
  for (const val of Object.values(value)) {
    const found = findValueByKey(val, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findNumeric(value, keys) {
  const found = findValueByKey(value, keys);
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

function normalizeServer(data) {
  const players = findNumeric(data, ["players", "playersOnline", "onlinePlayers", "playerCount", "currentPlayers"]);
  const maxPlayers = findNumeric(data, ["maxPlayers", "max_players", "slots", "maxSlots", "capacity"]);
  const online = findValueByKey(data, ["online", "isOnline", "serverOnline"]);
  const status = findValueByKey(data, ["status", "state"]);
  const version = findValueByKey(data, ["version", "serverVersion"]);
  const map = findValueByKey(data, ["map", "mapName", "mapname"]);

  return {
    online: typeof online === "boolean" ? online : true,
    players,
    maxPlayers,
    status: status ?? null,
    version: version ?? null,
    map: map ?? null
  };
}

function normalizePlayers(data) {
  const arr = findArray(data, ["players", "onlinePlayers", "online_players", "items", "entries", "records", "rows", "data", "results"]);
  if (!arr) return [];
  return arr.map((p, index) => {
    if (!isObject(p)) return { id: index, name: String(p), steamId: null };
    return {
      id: p.id ?? index,
      name: p.name ?? p.playerName ?? p.player_name ?? p.displayName ?? p.username ?? "Unknown Survivor",
      steamId: p.steamId ?? p.steam_id ?? p.steamID ?? null,
      playtime: p.playtime ?? p.playTime ?? p.totalPlaytime ?? null,
      ping: p.ping ?? null
    };
  });
}

function normalizeLeaderboard(data, kind) {
  const arr = findArray(data, ["leaderboard", "rankings", kind, "entries", "players", "items", "data"]) || [];
  return arr.map((item, index) => {
    if (!isObject(item)) return { rank: index + 1, name: String(item), value: null };
    const value = kind === "kills"
      ? item.kills ?? item.killCount ?? item.killsCount ?? item.value ?? item.score ?? null
      : item.playtime ?? item.playTime ?? item.totalPlaytime ?? item.hours ?? item.minutes ?? item.value ?? null;
    return {
      rank: item.rank ?? item.position ?? index + 1,
      name: item.name ?? item.playerName ?? item.player_name ?? item.displayName ?? item.username ?? "Unknown Survivor",
      value
    };
  });
}

async function readJsonResponse(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { return { raw: text.slice(0, 2000) }; }
}

async function prisonerFetch(env, path, query = "") {
  if (!env.PRISONER_API_TOKEN) throw new Error("PRISONER_API_TOKEN fehlt");
  const target = new URL(path, PRISONER_BASE);
  if (query) target.search = query;
  const started = Date.now();
  const response = await fetch(target, {
    method: "GET",
    headers: { "Accept": "application/json", "PRISONER-BOT-TOKEN": env.PRISONER_API_TOKEN }
  });
  return {
    ok: response.ok,
    status: response.status,
    endpoint: path,
    responseMs: Date.now() - started,
    data: await readJsonResponse(response)
  };
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function gs4uFetch() {
  const started = Date.now();
  try {
    const response = await fetch(GS4U_URL, {
      headers: { "Accept": "text/html,application/xhtml+xml", "User-Agent": "ShadowForge-Live/2.1" },
      cf: { cacheTtl: 5, cacheEverything: false }
    });
    const html = await response.text();
    const text = stripHtml(html);

    const online = /Status:\s*Online/i.test(text);
    const address = firstMatch(text, [/IP:Port\s+([0-9.]+:\d+)/i]);
    const playersMatch = text.match(/Spieler:\s*(\d+)\s*von\s*(\d+)/i);
    const name = firstMatch(text, [/#\s*([^\n]{3,100})\s*\d{1,3}\.\d{1,3}\./]);
    const map = firstMatch(text, [/Karte:\s*([^·]{1,80}?)(?=\s+Beschreibung|$)/i]);
    const version = firstMatch(text, [/Version:\s*([^·]{1,80})/i]);
    const updated = firstMatch(text, [/Informationen aktualisiert:\s*([^·]{1,100})/i]);

    const players = playersMatch ? Number(playersMatch[1]) : null;
    const maxPlayers = playersMatch ? Number(playersMatch[2]) : null;

    return {
      configured: true,
      ok: response.ok && Boolean(address),
      status: response.status,
      responseMs: Date.now() - started,
      source: "GS4u Live Monitor",
      server: {
        online,
        name: name || PUBLIC_SERVER.name,
        players,
        maxPlayers,
        map: map && map.trim() !== "-" && !/^beschreibung\b/i.test(map.trim()) ? map.trim() : null,
        version: version && version.trim() !== "-" ? version.trim() : null,
        ping: null,
        address: PUBLIC_SERVER.connectAddress,
        updated: new Date().toISOString(),
        monitorUpdatedText: updated
      },
      players: [],
      error: null
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      status: 502,
      responseMs: Date.now() - started,
      source: "GS4u Live Monitor",
      server: null,
      players: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function queryBridgeFetch(env) {
  if (!env.SCUM_QUERY_BRIDGE_URL) {
    return { configured: false, ok: false, error: "SCUM_QUERY_BRIDGE_URL fehlt", server: null, players: [] };
  }

  const started = Date.now();
  const url = new URL(env.SCUM_QUERY_BRIDGE_URL);

  const headers = { "Accept": "application/json" };
  if (env.SCUM_QUERY_BRIDGE_KEY) headers["X-Shadow-Forge-Key"] = env.SCUM_QUERY_BRIDGE_KEY;

  try {
    const response = await fetch(url, { method: "GET", headers, cf: { cacheTtl: 5, cacheEverything: false } });
    const data = await readJsonResponse(response);
    return {
      configured: true,
      ok: response.ok && data?.ok !== false,
      status: response.status,
      responseMs: Date.now() - started,
      server: data?.server ?? null,
      players: Array.isArray(data?.players) ? data.players : [],
      error: data?.error ?? null
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      status: 502,
      responseMs: Date.now() - started,
      server: null,
      players: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function cachedJson(requestKey, loader, ttl = CACHE_TTL_MS) {
  const cache = caches.default;
  const cacheKey = new Request(`https://shadow-forge-cache.invalid/${encodeURIComponent(requestKey)}`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const storedAt = Number(cached.headers.get("X-Shadow-Forge-Stored-At") || 0);
    if (storedAt && Date.now() - storedAt < ttl) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("X-Shadow-Forge-Cache", "HIT");
      return hit;
    }
  }
  const value = await loader();
  const response = json(value);
  const headers = new Headers(response.headers);
  headers.set("X-Shadow-Forge-Stored-At", String(Date.now()));
  headers.set("X-Shadow-Forge-Cache", "MISS");
  const cacheResponse = new Response(response.body, { status: 200, headers });
  await cache.put(cacheKey, cacheResponse.clone());
  return cacheResponse;
}

function publicServerView(server) {
  if (!server) return null;
  return {
    online: server.online !== false,
    name: server.name || PUBLIC_SERVER.name,
    players: typeof server.players === "number" ? server.players : null,
    maxPlayers: PUBLIC_SERVER.maxPlayersFallback,
    version: server.version ?? null,
    map: server.map ?? null,
    ping: typeof server.ping === "number" ? server.ping : null,
    address: PUBLIC_SERVER.connectAddress
  };
}

function mergeLive(queryResult, gs4uResult, prisonerServerResult, prisonerPlayersResult) {
  const queryServer = queryResult?.server ?? null;
  const gs4uServer = gs4uResult?.server ?? null;
  const prisonerServer = prisonerServerResult?.ok ? normalizeServer(prisonerServerResult.data) : null;
  const databasePlayers = prisonerPlayersResult?.ok ? normalizePlayers(prisonerPlayersResult.data) : [];
  const queryPlayers = Array.isArray(queryResult?.players) ? queryResult.players : [];

  const online = queryResult?.ok
    ? queryServer?.online !== false
    : gs4uResult?.ok
      ? gs4uServer?.online !== false
      : Boolean(prisonerServer?.online);

  const players = queryResult?.ok && queryPlayers.length
    ? queryPlayers
    : databasePlayers;

  const currentPlayers = queryServer?.players ?? gs4uServer?.players ?? prisonerServer?.players ?? null;
  const maxPlayers = queryServer?.maxPlayers ?? gs4uServer?.maxPlayers ?? prisonerServer?.maxPlayers ?? null;
  const version = queryServer?.version || gs4uServer?.version || prisonerServer?.version || null;
  const map = queryServer?.map || gs4uServer?.map || prisonerServer?.map || null;
  const hostname = queryServer?.name || gs4uServer?.name || PUBLIC_SERVER.name;
  const ping = queryServer?.ping ?? null;

  let liveSource = "Prisoner Bot";
  if (queryResult?.ok) liveSource = "SCUM Query";
  else if (gs4uResult?.ok) liveSource = "GS4u Live Monitor";

  return {
    online,
    status: online ? "online" : "offline",
    players: currentPlayers,
    maxPlayers: PUBLIC_SERVER.maxPlayersFallback,
    version,
    map,
    hostname,
    ping,
    playerList: players.map((player, index) => ({
      id: index + 1,
      name: player?.name || "Unknown Survivor",
      ping: player?.ping ?? null
    })),
    playerListSource: queryResult?.ok && queryPlayers.length ? "SCUM Query" : (databasePlayers.length ? "Prisoner Bot Public API" : "Nicht verfügbar"),
    liveSource,
    address: PUBLIC_SERVER.connectAddress
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "shadow-forge-api-v2.3",
        timestamp: new Date().toISOString(),
        publicServer: {
          name: PUBLIC_SERVER.name,
          maxPlayersFallback: PUBLIC_SERVER.maxPlayersFallback
        },
        integrations: {
          prisonerBot: Boolean(env.PRISONER_API_TOKEN),
          liveQuery: Boolean(env.SCUM_QUERY_BRIDGE_URL),
          gs4uFallback: true
        }
      });
    }

    if (url.pathname === "/api/query") {
      return cachedJson("query", async () => {
        const result = await queryBridgeFetch(env);
        return {
          ok: result.ok,
          source: "Shadow Forge Live Query",
          server: result.server ? {
            online: result.server.online === true,
            players: result.server.players ?? null,
            maxPlayers: result.server.maxPlayers ?? PUBLIC_SERVER.maxPlayersFallback,
            version: result.server.version ?? null,
            map: result.server.map ?? null,
            name: result.server.name ?? PUBLIC_SERVER.name,
            ping: result.server.ping ?? null
          } : null,
          players: (result.players || []).map((player, index) => ({ id: index + 1, name: player?.name || "Unknown Survivor", ping: player?.ping ?? null }))
        };
      }, 5_000);
    }

    if (url.pathname === "/api/gs4u") {
      return cachedJson("gs4u", async () => {
        const result = await gs4uFetch();
        return {
          ok: result.ok,
          source: result.source,
          server: result.server ? {
            online: result.server.online,
            name: result.server.name,
            players: result.server.players,
            maxPlayers: result.server.maxPlayers ?? PUBLIC_SERVER.maxPlayersFallback,
            map: result.server.map,
            version: result.server.version
          } : null
        };
      }, 10_000);
    }

    if (url.pathname === "/api/live") {
      return cachedJson("live", async () => {
        const started = Date.now();
        const [queryResult, gs4uResult, prisonerServerResult, prisonerPlayersResult] = await Promise.all([
          queryBridgeFetch(env),
          gs4uFetch(),
          prisonerFetch(env, PATHS.server),
          prisonerFetch(env, PATHS.players)
        ]);
        const live = mergeLive(queryResult, gs4uResult, prisonerServerResult, prisonerPlayersResult);
        return {
          ok: Boolean(queryResult.ok || gs4uResult.ok || prisonerServerResult.ok || prisonerPlayersResult.ok),
          source: "Shadow Forge Live API V2.1",
          timestamp: new Date().toISOString(),
          responseMs: Date.now() - started,
          server: live,
          sources: {
            scumQuery: { ok: queryResult.ok, responseMs: queryResult.responseMs },
            gs4u: { ok: gs4uResult.ok, responseMs: gs4uResult.responseMs },
            prisonerServer: { ok: prisonerServerResult.ok, responseMs: prisonerServerResult.responseMs },
            prisonerPlayers: { ok: prisonerPlayersResult.ok, responseMs: prisonerPlayersResult.responseMs }
          }
        };
      });
    }

    if (url.pathname === "/api/server") {
      try {
        const [gs4u, prisoner] = await Promise.all([gs4uFetch(), prisonerFetch(env, PATHS.server, url.search.slice(1))]);
        if (gs4u.ok) return json({ ok: true, source: gs4u.source, server: publicServerView(gs4u.server), fallback: prisoner.ok ? publicServerView(normalizeServer(prisoner.data)) : null });
        if (!prisoner.ok) return json({ ok: false, error: "No live server source available" }, 503);
        return json({ ok: true, source: "Prisoner Bot Public API", server: publicServerView(normalizeServer(prisoner.data)) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 503);
      }
    }

    if (url.pathname === "/api/players") {
      try {
        const result = await prisonerFetch(env, PATHS.players, url.search.slice(1));
        if (!result.ok) return json({ ok: false, ...result }, result.status);
        const players = normalizePlayers(result.data);
        return json({ ok: true, source: "Prisoner Bot Public API", endpoint: result.endpoint, count: players.length, players });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 503);
      }
    }

    if (url.pathname === "/api/leaderboard") {
      const kind = url.searchParams.get("type") === "playtime" ? "playtime" : "kills";
      try {
        const result = await prisonerFetch(env, PATHS[kind], url.search.slice(1));
        if (!result.ok) return json({ ok: false, ...result }, result.status);
        return json({ ok: true, source: "Prisoner Bot Public API", endpoint: result.endpoint, type: kind, leaderboard: normalizeLeaderboard(result.data, kind) });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 503);
      }
    }

    if (!url.pathname.startsWith("/api/") && env.ASSETS) return env.ASSETS.fetch(request);

    return new Response("Shadow Forge API V2.1", { status: 404, headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=UTF-8" } });
  }
};
