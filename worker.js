const PRISONER_BASE = "https://scum.theprisonerbot.com/api";

const SCUM_SERVER = {
  name: "Shadow Forge",
  host: "176.57.174.127",
  gamePort: 28202,
  queryPort: 28215,
  connectAddress: "176.57.174.127:28202"
};

const PATHS = {
  server: "/server",
  players: "/players",
  kills: "/leaderboard/kills",
  playtime: "/leaderboard/playtime"
};

const CACHE_TTL_MS = 15_000;

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

  const common = [
    "players", "onlinePlayers", "online_players", "leaderboard",
    "rankings", "items", "results", "rows", "data", "entries", "records"
  ];

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
  const players = findNumeric(data, [
    "players", "playersOnline", "onlinePlayers", "playerCount", "currentPlayers"
  ]);
  const maxPlayers = findNumeric(data, [
    "maxPlayers", "max_players", "slots", "maxSlots", "capacity"
  ]);
  const online = findValueByKey(data, ["online", "isOnline", "serverOnline"]);
  const status = findValueByKey(data, ["status", "state"]);
  const version = findValueByKey(data, ["version", "serverVersion"]);

  return {
    online: typeof online === "boolean" ? online : true,
    players,
    maxPlayers,
    status: status ?? null,
    version: version ?? null,
    raw: data
  };
}

function normalizePlayers(data) {
  const arr = findArray(data, [
    "players", "onlinePlayers", "online_players", "items", "entries", "records", "rows", "data", "results"
  ]);
  if (!arr) return [];

  return arr.map((p, index) => {
    if (!isObject(p)) return { id: index, name: String(p), steamId: null };
    return {
      id: p.id ?? index,
      name: p.name ?? p.playerName ?? p.player_name ?? p.displayName ?? p.username ?? "Unknown Survivor",
      steamId: p.steamId ?? p.steam_id ?? p.steamID ?? null,
      playtime: p.playtime ?? p.playTime ?? p.totalPlaytime ?? null
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
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 2000) };
  }
}

async function prisonerFetch(env, path, query = "") {
  if (!env.PRISONER_API_TOKEN) throw new Error("PRISONER_API_TOKEN fehlt");

  const target = new URL(path, PRISONER_BASE);
  if (query) target.search = query;

  const started = Date.now();
  const response = await fetch(target, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "PRISONER-BOT-TOKEN": env.PRISONER_API_TOKEN
    }
  });

  return {
    ok: response.ok,
    status: response.status,
    endpoint: path,
    responseMs: Date.now() - started,
    data: await readJsonResponse(response)
  };
}

async function queryBridgeFetch(env) {
  if (!env.SCUM_QUERY_BRIDGE_URL) {
    return {
      configured: false,
      ok: false,
      error: "SCUM_QUERY_BRIDGE_URL fehlt",
      server: null,
      players: []
    };
  }

  const started = Date.now();
  const url = new URL(env.SCUM_QUERY_BRIDGE_URL);
  url.searchParams.set("host", SCUM_SERVER.host);
  url.searchParams.set("port", String(SCUM_SERVER.queryPort));

  const headers = { "Accept": "application/json" };
  if (env.SCUM_QUERY_BRIDGE_KEY) headers["X-Shadow-Forge-Key"] = env.SCUM_QUERY_BRIDGE_KEY;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      cf: { cacheTtl: 5, cacheEverything: false }
    });
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

async function cachedJson(env, requestKey, loader, ttl = CACHE_TTL_MS) {
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

function mergeLive(queryResult, prisonerServerResult, prisonerPlayersResult) {
  const queryServer = queryResult?.server ?? null;
  const prisonerServer = prisonerServerResult?.ok ? normalizeServer(prisonerServerResult.data) : null;
  const databasePlayers = prisonerPlayersResult?.ok ? normalizePlayers(prisonerPlayersResult.data) : [];

  const queryPlayers = Array.isArray(queryResult?.players) ? queryResult.players : [];

  const online = queryResult?.configured
    ? Boolean(queryResult.ok && queryServer?.online !== false)
    : Boolean(prisonerServer?.online);

  const players = queryResult?.ok
    ? (queryPlayers.length ? queryPlayers : databasePlayers)
    : databasePlayers;

  const currentPlayers = queryServer?.players ?? prisonerServer?.players ?? null;
  const maxPlayers = queryServer?.maxPlayers ?? prisonerServer?.maxPlayers ?? null;
  const version = queryServer?.version || prisonerServer?.version || null;

  return {
    online,
    status: online ? "online" : "offline",
    players: currentPlayers,
    maxPlayers,
    version,
    map: queryServer?.map ?? null,
    hostname: queryServer?.name ?? SCUM_SERVER.name,
    ping: queryServer?.ping ?? null,
    queryPort: queryServer?.queryPort ?? SCUM_SERVER.queryPort,
    gamePort: SCUM_SERVER.gamePort,
    playerList: players,
    playerListSource: queryResult?.ok ? "SCUM Query" : "Prisoner Bot Public API"
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "shadow-forge-api-v2",
        timestamp: new Date().toISOString(),
        server: SCUM_SERVER,
        prisonerApiConfigured: Boolean(env.PRISONER_API_TOKEN),
        queryBridgeConfigured: Boolean(env.SCUM_QUERY_BRIDGE_URL),
        endpoints: [
          "/api/live",
          "/api/query",
          "/api/server",
          "/api/players",
          "/api/leaderboard?type=kills",
          "/api/leaderboard?type=playtime"
        ]
      });
    }

    if (url.pathname === "/api/query") {
      return cachedJson(env, "query", async () => {
        const result = await queryBridgeFetch(env);
        return {
          ok: result.ok,
          source: "Shadow Forge SCUM Query Bridge",
          serverConfig: SCUM_SERVER,
          ...result
        };
      }, 5_000);
    }

    if (url.pathname === "/api/live") {
      return cachedJson(env, "live", async () => {
        const started = Date.now();
        const [queryResult, prisonerServerResult, prisonerPlayersResult] = await Promise.all([
          queryBridgeFetch(env),
          prisonerFetch(env, PATHS.server),
          prisonerFetch(env, PATHS.players)
        ]);

        const live = mergeLive(queryResult, prisonerServerResult, prisonerPlayersResult);

        return {
          ok: Boolean(queryResult.ok || prisonerServerResult.ok || prisonerPlayersResult.ok),
          source: "Shadow Forge Live API V2",
          timestamp: new Date().toISOString(),
          responseMs: Date.now() - started,
          server: live,
          sources: {
            scumQuery: queryResult,
            prisonerServer: {
              ok: prisonerServerResult.ok,
              status: prisonerServerResult.status,
              responseMs: prisonerServerResult.responseMs
            },
            prisonerPlayers: {
              ok: prisonerPlayersResult.ok,
              status: prisonerPlayersResult.status,
              responseMs: prisonerPlayersResult.responseMs
            }
          },
          connection: SCUM_SERVER
        };
      });
    }

    if (url.pathname === "/api/server") {
      try {
        const result = await prisonerFetch(env, PATHS.server, url.search.slice(1));
        if (!result.ok) return json({ ok: false, ...result }, result.status);
        return json({ ok: true, source: "Prisoner Bot Public API", endpoint: result.endpoint, server: normalizeServer(result.data) });
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

    if (!url.pathname.startsWith("/api/") && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/leaderboard") {
      const kind = url.searchParams.get("type") === "playtime" ? "playtime" : "kills";
      try {
        const result = await prisonerFetch(env, PATHS[kind], url.search.slice(1));
        if (!result.ok) return json({ ok: false, ...result }, result.status);
        return json({
          ok: true,
          source: "Prisoner Bot Public API",
          endpoint: result.endpoint,
          type: kind,
          leaderboard: normalizeLeaderboard(result.data, kind)
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 503);
      }
    }

    return new Response("Shadow Forge API V2", {
      status: 404,
      headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=UTF-8" }
    });
  }
};
