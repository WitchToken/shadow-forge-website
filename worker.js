const PRISONER_BASE = "https://scum.theprisonerbot.com/api";
const GS4U_URL = "https://www.gs4u.net/de/s/436818";

const PUBLIC_SERVER = {
  name: "Shadow Forge",
  connectAddress: "176.57.174.127:28202",
  maxPlayers: 60
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
    "Access-Control-Allow-Headers": "Content-Type, X-Shadow-Forge-Key",
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
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeServer(data) {
  const players = numeric(findValueByKey(data, ["players", "playersOnline", "onlinePlayers", "playerCount", "currentPlayers"]));
  const maxPlayers = numeric(findValueByKey(data, ["maxPlayers", "max_players", "slots", "maxSlots", "capacity"]));
  const onlineValue = findValueByKey(data, ["online", "isOnline", "serverOnline"]);
  const version = findValueByKey(data, ["version", "serverVersion"]);
  const map = findValueByKey(data, ["map", "mapName", "mapname"]);
  return {
    online: typeof onlineValue === "boolean" ? onlineValue : true,
    players,
    maxPlayers,
    version: typeof version === "string" ? version : null,
    map: typeof map === "string" ? map : null
  };
}

function normalizePlayers(data) {
  const arr = findArray(data, ["players", "onlinePlayers", "online_players", "items", "entries", "records", "rows", "data", "results"]);
  if (!arr) return [];
  return arr.map((p, index) => {
    if (!isObject(p)) return { id: index + 1, name: String(p), ping: null };
    return {
      id: index + 1,
      name: p.name ?? p.playerName ?? p.player_name ?? p.displayName ?? p.username ?? "Unknown Survivor",
      ping: numeric(p.ping)
    };
  });
}

function normalizeLeaderboard(data, kind) {
  const arr = findArray(data, ["leaderboard", "rankings", kind, "entries", "players", "items", "data"]) || [];
  return arr.map((item, index) => {
    if (!isObject(item)) return { rank: index + 1, name: String(item), value: null };
    let value = kind === "kills"
      ? item.kills ?? item.killCount ?? item.killsCount ?? item.value ?? item.score ?? null
      : item.playtime ?? item.playTime ?? item.totalPlaytime ?? item.hours ?? item.minutes ?? item.value ?? null;
    if (typeof value === "object" && value !== null) {
      value = value.formatted ?? value.hours ?? value.minutes ?? value.total ?? value.value ?? null;
    }
    return {
      rank: item.rank ?? item.position ?? index + 1,
      name: item.name ?? item.playerName ?? item.player_name ?? item.displayName ?? item.username ?? "Unknown Survivor",
      value
    };
  });
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
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
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "ShadowForge-Live/2.6" },
      cf: { cacheTtl: 5, cacheEverything: false }
    });
    const html = await response.text();
    const text = cleanText(html);
    const online = /Status:\s*Online/i.test(text);
    const playersMatch = text.match(/Spieler:\s*(\d+)\s*von\s*(\d+)/i);
    const players = playersMatch ? Number(playersMatch[1]) : null;
    return {
      ok: response.ok,
      responseMs: Date.now() - started,
      server: {
        online,
        players,
        // Intentionally ignored: GS4u may lag behind the real Shadow Forge capacity.
        maxPlayers: PUBLIC_SERVER.maxPlayers
      }
    };
  } catch (error) {
    return { ok: false, responseMs: Date.now() - started, server: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function queryBridgeFetch(env) {
  if (!env.SCUM_QUERY_BRIDGE_URL) return { ok: false, configured: false, server: null, players: [], responseMs: 0 };
  const started = Date.now();
  try {
    const headers = { Accept: "application/json" };
    if (env.SCUM_QUERY_BRIDGE_KEY) headers["X-Shadow-Forge-Key"] = env.SCUM_QUERY_BRIDGE_KEY;
    const response = await fetch(env.SCUM_QUERY_BRIDGE_URL, { headers, cf: { cacheTtl: 3, cacheEverything: false } });
    const data = await readJson(response);
    return {
      ok: response.ok && data?.ok === true,
      configured: true,
      responseMs: Date.now() - started,
      server: data?.server ?? null,
      players: Array.isArray(data?.players) ? data.players : [],
      error: data?.error ?? null
    };
  } catch (error) {
    return { ok: false, configured: true, server: null, players: [], responseMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
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

function publicServer(server) {
  return {
    online: Boolean(server?.online),
    name: PUBLIC_SERVER.name,
    players: numeric(server?.players),
    maxPlayers: PUBLIC_SERVER.maxPlayers,
    version: typeof server?.version === "string" && server.version.trim() ? server.version.trim() : null,
    map: typeof server?.map === "string" && server.map.trim() && server.map.trim() !== "-" ? server.map.trim() : null,
    ping: numeric(server?.ping)
  };
}

function mergeLive(query, gs4u, prisonerServer, prisonerPlayers, kills, playtime) {
  const pServer = prisonerServer?.ok ? normalizeServer(prisonerServer.data) : null;
  const dbPlayers = prisonerPlayers?.ok ? normalizePlayers(prisonerPlayers.data) : [];
  const qServer = query?.ok ? query.server : null;
  const gServer = gs4u?.ok ? gs4u.server : null;

  const online = query?.ok ? qServer?.online !== false : gs4u?.ok ? gServer?.online !== false : pServer?.online === true;
  const currentPlayers = numeric(qServer?.players) ?? numeric(gServer?.players) ?? numeric(pServer?.players);
  const version = qServer?.version || pServer?.version || null;
  const map = qServer?.map || pServer?.map || null;
  const ping = numeric(qServer?.ping);
  const queryPlayerList = query?.ok ? query.players : [];
  const playerList = queryPlayerList.map((p, i) => ({ id: i + 1, name: p?.name || "Unknown Survivor", ping: numeric(p?.ping) }));

  const source = query?.ok ? "SCUM Query" : gs4u?.ok ? "GS4u Live Monitor" : pServer ? "Prisoner Bot" : "Nicht verfügbar";

  return {
    online,
    hostname: PUBLIC_SERVER.name,
    players: currentPlayers,
    maxPlayers: PUBLIC_SERVER.maxPlayers,
    version,
    map,
    ping,
    playerList,
    playerListSource: queryPlayerList.length ? "SCUM Query" : "Keine Live-Namensquelle",
    liveSource: source,
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
      return json({ ok: true, discordUrl: env.DISCORD_URL || "https://discord.gg/XDsAjmSFhq" });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "shadow-forge-live-api-v2.8",
        timestamp: new Date().toISOString(),
        integrations: {
          scumQueryBridge: Boolean(env.SCUM_QUERY_BRIDGE_URL),
          prisonerBot: Boolean(env.PRISONER_API_TOKEN),
          gs4uLiveFallback: true
        }
      });
    }

    if (url.pathname === "/api/live") {
      return cachedJson("live", async () => {
        const started = Date.now();
        const [query, gs4u, prisonerServer, prisonerPlayers, kills, playtime] = await Promise.all([
          queryBridgeFetch(env),
          gs4uFetch(),
          prisonerFetch(env, PATHS.server),
          prisonerFetch(env, PATHS.players),
          prisonerFetch(env, PATHS.kills),
          prisonerFetch(env, PATHS.playtime)
        ]);
        const server = mergeLive(query, gs4u, prisonerServer, prisonerPlayers, kills, playtime);
        return {
          ok: Boolean(query.ok || gs4u.ok || prisonerServer.ok || prisonerPlayers.ok),
          timestamp: new Date().toISOString(),
          responseMs: Date.now() - started,
          server,
          sources: {
            query: Boolean(query.ok),
            scumQuery: { ok: Boolean(query.ok), configured: Boolean(query.configured) },
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
      const result = await queryBridgeFetch(env);
      return json({
        ok: result.ok,
        source: "SCUM A2S Query",
        server: result.server ? {
          online: result.server.online === true,
          players: numeric(result.server.players),
          maxPlayers: PUBLIC_SERVER.maxPlayers,
          version: result.server.version ?? null,
          map: result.server.map ?? null,
          ping: numeric(result.server.ping)
        } : null,
        players: result.ok ? result.players.map((p, i) => ({ id: i + 1, name: p?.name || "Unknown Survivor", ping: numeric(p?.ping) })) : []
      });
    }

    if (url.pathname === "/api/players") {
      // Deliberately expose only live A2S names. The Prisoner Bot database is not necessarily an online list.
      const result = await queryBridgeFetch(env);
      return json({
        ok: result.ok,
        source: result.ok ? "SCUM A2S Query" : "Nicht verfügbar",
        count: result.ok ? result.players.length : 0,
        players: result.ok ? result.players.map((p, i) => ({ id: i + 1, name: p?.name || "Unknown Survivor", ping: numeric(p?.ping) })) : []
      });
    }

    if (!url.pathname.startsWith("/api/") && env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Shadow Forge Live API", { status: 404, headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=UTF-8" } });
  }
};
