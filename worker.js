const BASE = "https://scum.theprisonerbot.com";

const PATHS = {
  server: "/server",
  players: "/players",
  kills: "/leaderboard/kills",
  playtime: "/leaderboard/playtime"
};

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

async function prisonerFetch(env, path, query = "") {
  if (!env.PRISONER_API_TOKEN) throw new Error("PRISONER_API_TOKEN fehlt");
  const target = new URL(path, BASE);
  if (query) target.search = query;

  const response = await fetch(target, {
    method: "GET",
    headers: {
      "PRISONER-BOT-TOKEN": env.PRISONER_API_TOKEN,
      "Accept": "application/json"
    }
  });

  const text = await response.text();
  let body;
  try { body = JSON.parse(text); }
  catch { body = { raw: text.slice(0, 4000) }; }

  return { ok: response.ok, status: response.status, endpoint: path, data: body };
}

function isObject(v) { return v && typeof v === "object" && !Array.isArray(v); }

// Prisoner Bot can wrap payloads in data/results/items/etc. Walk the response
// instead of assuming a single fixed JSON nesting level.
function findArray(value, preferred = [], depth = 0) {
  if (depth > 8 || value == null) return null;
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return null;

  for (const key of preferred) {
    if (Array.isArray(value[key])) return value[key];
  }

  const common = ["players", "leaderboard", "rankings", "items", "results", "rows", "data", "entries", "records"];
  for (const key of common) {
    if (Array.isArray(value[key])) return value[key];
  }

  for (const key of Object.keys(value)) {
    const found = findArray(value[key], preferred, depth + 1);
    if (found) return found;
  }
  return null;
}

function findScalar(value, keys, depth = 0) {
  if (depth > 8 || value == null || !isObject(value)) return undefined;
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }
  for (const key of Object.keys(value)) {
    const found = findScalar(value[key], keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function normalizeServer(data) {
  const playersRaw = findScalar(data, ["players", "onlinePlayers", "playerCount", "online_players", "currentPlayers"]);
  const maxRaw = findScalar(data, ["maxPlayers", "max_players", "slots", "max", "maxPlayerCount"]);
  const statusRaw = findScalar(data, ["status", "serverStatus"]);
  const onlineRaw = findScalar(data, ["online", "isOnline", "serverOnline"]);

  const players = Number(playersRaw);
  const maxPlayers = Number(maxRaw);
  const status = typeof statusRaw === "string" ? statusRaw.toLowerCase() : "";

  let online;
  if (typeof onlineRaw === "boolean") online = onlineRaw;
  else if (status) online = !["offline", "down", "stopped", "unavailable", "maintenance"].includes(status);
  else online = true; // HTTP 200 from /server is our fallback signal.

  return {
    online,
    players: Number.isFinite(players) ? players : null,
    maxPlayers: Number.isFinite(maxPlayers) ? maxPlayers : null,
    status: statusRaw ?? null
  };
}

function playerName(x) {
  return x?.name ?? x?.player ?? x?.playerName ?? x?.username ?? x?.steamName ?? x?.displayName ?? "Player";
}

function rankingValue(x, kind) {
  if (kind === "kills") return x?.kills ?? x?.killCount ?? x?.killsCount ?? x?.value ?? x?.score ?? "—";
  return x?.playtime ?? x?.playTime ?? x?.totalPlaytime ?? x?.hours ?? x?.minutes ?? x?.value ?? "—";
}

function normalizePlayers(data) {
  return findArray(data, ["players", "onlinePlayers", "online_players"]) || [];
}

function normalizeLeaderboard(data, kind) {
  return findArray(data, ["leaderboard", "rankings", kind, "entries", "players"]) || [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "shadow-forge-api", prisoner_base_url: BASE, token_configured: Boolean(env.PRISONER_API_TOKEN), endpoints: PATHS });
    }

    if (url.pathname === "/api/server") {
      try {
        const result = await prisonerFetch(env, PATHS.server);
        if (!result.ok) return json({ ok: false, endpoint: result.endpoint, status: result.status, data: result.data }, result.status);
        const server = normalizeServer(result.data);
        return json({ ok: true, source: "Prisoner Bot", endpoint: result.endpoint, ...server, players_available: server.players !== null });
      } catch (e) { return json({ ok: false, error: e.message }, 503); }
    }

    if (url.pathname === "/api/players") {
      try {
        const result = await prisonerFetch(env, PATHS.players, url.search.slice(1));
        if (!result.ok) return json({ ok: false, endpoint: result.endpoint, status: result.status, data: result.data }, result.status);
        const players = normalizePlayers(result.data);
        return json({ ok: true, source: "Prisoner Bot", endpoint: result.endpoint, count: players.length, players });
      } catch (e) { return json({ ok: false, error: e.message }, 503); }
    }

    if (url.pathname === "/api/leaderboard") {
      const kind = url.searchParams.get("type") === "playtime" ? "playtime" : "kills";
      try {
        const result = await prisonerFetch(env, PATHS[kind], url.search.slice(1));
        if (!result.ok) return json({ ok: false, endpoint: result.endpoint, status: result.status, data: result.data }, result.status);
        const leaderboard = normalizeLeaderboard(result.data, kind);
        return json({ ok: true, source: "Prisoner Bot", type: kind, endpoint: result.endpoint, count: leaderboard.length, leaderboard });
      } catch (e) { return json({ ok: false, error: e.message }, 503); }
    }

    if (url.pathname === "/api/prisoner-discovery") {
      const results = {};
      for (const [kind, path] of Object.entries(PATHS)) {
        try {
          const result = await prisonerFetch(env, path);
          results[kind] = { ok: result.ok, endpoint: path, status: result.status };
        } catch (e) { results[kind] = { ok: false, endpoint: path, error: e.message }; }
      }
      return json({ ok: true, base: BASE, results });
    }

    return env.ASSETS.fetch(request);
  }
};
