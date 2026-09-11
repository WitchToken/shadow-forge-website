const BASE = "https://scum.theprisonerbot.com/api";

const PATHS = {
  server: "/server",
  players: "/players",
  kills: "/leaderboard/kills",
  playtime: "/leaderboard/playtime"
};

const CACHE_TTL_MS = 20_000;

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: corsHeaders()
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
    "players",
    "onlinePlayers",
    "online_players",
    "leaderboard",
    "rankings",
    "items",
    "results",
    "rows",
    "data",
    "entries",
    "records"
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
    "players",
    "playersOnline",
    "onlinePlayers",
    "playerCount",
    "currentPlayers"
  ]);

  const maxPlayers = findNumeric(data, [
    "maxPlayers",
    "max_players",
    "slots",
    "maxSlots",
    "capacity"
  ]);

  const online = findValueByKey(data, [
    "online",
    "isOnline",
    "serverOnline"
  ]);

  const status = findValueByKey(data, [
    "status",
    "state"
  ]);

  const version = findValueByKey(data, [
    "version",
    "serverVersion"
  ]);

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
    "players",
    "onlinePlayers",
    "online_players",
    "items",
    "entries",
    "records",
    "rows",
    "data",
    "results"
  ]);

  if (!arr) return [];

  return arr.map((p, index) => {
    if (!isObject(p)) {
      return {
        id: index,
        name: String(p),
        steamId: null
      };
    }

    return {
      id: p.id ?? index,
      name:
        p.name ??
        p.playerName ??
        p.player_name ??
        p.displayName ??
        p.username ??
        "Unknown Survivor",
      steamId:
        p.steamId ??
        p.steam_id ??
        p.steamID ??
        null,
      playtime:
        p.playtime ??
        p.playTime ??
        p.totalPlaytime ??
        null
    };
  });
}

function normalizeLeaderboard(data, kind) {
  const arr =
    findArray(data, [
      "leaderboard",
      "rankings",
      kind,
      "entries",
      "players",
      "items",
      "data"
    ]) || [];

  return arr.map((item, index) => {
    if (!isObject(item)) {
      return {
        rank: index + 1,
        name: String(item),
        value: null
      };
    }

    const value =
      kind === "kills"
        ? item.kills ??
          item.killCount ??
          item.killsCount ??
          item.value ??
          item.score ??
          null
        : item.playtime ??
          item.playTime ??
          item.totalPlaytime ??
          item.hours ??
          item.minutes ??
          item.value ??
          null;

    return {
      rank: item.rank ?? item.position ?? index + 1,
      name:
        item.name ??
        item.playerName ??
        item.player_name ??
        item.displayName ??
        item.username ??
        "Unknown Survivor",
      value
    };
  });
}

async function prisonerFetch(env, path, query = "") {
  if (!env.PRISONER_API_TOKEN) {
    throw new Error("PRISONER_API_TOKEN fehlt");
  }

  const target = new URL(path, BASE);
  if (query) target.search = query;

  const response = await fetch(target, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "PRISONER-BOT-TOKEN": env.PRISONER_API_TOKEN
    }
  });

  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = {
      raw: text.slice(0, 1000)
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    endpoint: path,
    data: body
  };
}

/*
 * Small edge cache.
 * This protects the Prisoner Bot API from being hit on every browser refresh
 * while keeping the public website feeling live.
 */
async function cachedFetch(env, path, query = "", ttl = CACHE_TTL_MS) {
  const cache = caches.default;
  const cacheUrl = new URL(`https://shadow-forge-cache.invalid${path}`);
  cacheUrl.search = query || "";

  const cacheKey = new Request(cacheUrl.toString(), {
    method: "GET"
  });

  const cached = await cache.match(cacheKey);
  if (cached) {
    const age = Number(cached.headers.get("X-Shadow-Forge-Age") || "0");
    if (Date.now() - age < ttl) {
      const clone = new Response(cached.body, cached);
      clone.headers.set("X-Shadow-Forge-Cache", "HIT");
      return clone;
    }
  }

  const result = await prisonerFetch(env, path, query);

  const response = json(result, result.ok ? 200 : result.status);

  const headers = new Headers(response.headers);
  headers.set("X-Shadow-Forge-Age", String(Date.now()));
  headers.set("X-Shadow-Forge-Cache", "MISS");

  const cacheResponse = new Response(response.body, {
    status: response.status,
    headers
  });

  if (result.ok) {
    await cache.put(cacheKey, cacheResponse.clone());
  }

  return cacheResponse;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "shadow-forge-api",
        prisoner_base_url: BASE,
        token_configured: Boolean(env.PRISONER_API_TOKEN),
        live_update_interval_seconds: 30,
        public_endpoints: [
          "/api/live",
          "/api/server",
          "/api/players",
          "/api/leaderboard?type=kills",
          "/api/leaderboard?type=playtime"
        ]
      });
    }

    /*
     * Main website endpoint.
     * The frontend only has to call /api/live.
     */
    if (url.pathname === "/api/live") {
      const started = Date.now();

      try {
        const [serverResponse, playersResponse] = await Promise.all([
          prisonerFetch(env, PATHS.server),
          prisonerFetch(env, PATHS.players)
        ]);

        const server = serverResponse.ok
          ? normalizeServer(serverResponse.data)
          : {
              online: false,
              players: null,
              maxPlayers: null,
              status: null,
              version: null,
              raw: null
            };

        const players = playersResponse.ok
          ? normalizePlayers(playersResponse.data)
          : [];

        /*
         * Important:
         * /players is the confirmed Public API player database endpoint.
         * It is NOT assumed to be the live RCON player list.
         *
         * If /server itself contains a player count, use it.
         * Otherwise leave player count null rather than inventing it.
         */
        const livePlayerCount =
          server.players !== null
            ? server.players
            : null;

        return json({
          ok: serverResponse.ok || playersResponse.ok,
          source: "Shadow Forge Live API",
          timestamp: new Date().toISOString(),
          response_ms: Date.now() - started,

          server: {
            online: server.online,
            status: server.status,
            players: livePlayerCount,
            maxPlayers: server.maxPlayers,
            version: server.version
          },

          players: {
            count: players.length,
            list: players
          },

          api: {
            server_ok: serverResponse.ok,
            players_ok: playersResponse.ok
          }
        });
      } catch (error) {
        return json(
          {
            ok: false,
            source: "Shadow Forge Live API",
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error)
          },
          503
        );
      }
    }

    if (url.pathname === "/api/server") {
      try {
        const result = await prisonerFetch(
          env,
          PATHS.server,
          url.search.slice(1)
        );

        if (!result.ok) {
          return json(
            {
              ok: false,
              endpoint: result.endpoint,
              status: result.status,
              data: result.data
            },
            result.status
          );
        }

        return json({
          ok: true,
          source: "Prisoner Bot Public API",
          endpoint: result.endpoint,
          server: normalizeServer(result.data)
        });
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          },
          503
        );
      }
    }

    if (url.pathname === "/api/players") {
      try {
        const result = await prisonerFetch(
          env,
          PATHS.players,
          url.search.slice(1)
        );

        if (!result.ok) {
          return json(
            {
              ok: false,
              endpoint: result.endpoint,
              status: result.status,
              data: result.data
            },
            result.status
          );
        }

        const players = normalizePlayers(result.data);

        return json({
          ok: true,
          source: "Prisoner Bot Public API",
          endpoint: result.endpoint,
          count: players.length,
          players
        });
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          },
          503
        );
      }
    }

    if (url.pathname === "/api/leaderboard") {
      const kind =
        url.searchParams.get("type") === "playtime"
          ? "playtime"
          : "kills";

      try {
        const result = await prisonerFetch(
          env,
          PATHS[kind],
          url.search.slice(1)
        );

        if (!result.ok) {
          return json(
            {
              ok: false,
              endpoint: result.endpoint,
              status: result.status,
              data: result.data
            },
            result.status
          );
        }

        const leaderboard = normalizeLeaderboard(
          result.data,
          kind
        );

        return json({
          ok: true,
          source: "Prisoner Bot Public API",
          type: kind,
          endpoint: result.endpoint,
          count: leaderboard.length,
          leaderboard
        });
      } catch (error) {
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          },
          503
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
