import baseWorker from "./worker.js";

const PRISONER_BASE = "https://scum.theprisonerbot.com/api";
const LEADERBOARD_CACHE_MS = 30_000;
const KILL_LIMIT = 10;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=UTF-8"
    }
  });
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function keyName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function findArray(value, preferred = [], depth = 0) {
  if (depth > 10 || value == null) return null;
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return null;

  for (const key of preferred) {
    if (Array.isArray(value[key])) return value[key];
  }

  const common = [
    "result", "results", "leaderboard", "rankings", "entries", "records",
    "items", "rows", "players", "data", "values"
  ];
  for (const key of common) {
    if (Array.isArray(value[key])) return value[key];
  }

  for (const child of Object.values(value)) {
    const found = findArray(child, preferred, depth + 1);
    if (found) return found;
  }

  return null;
}

function findLeaderboardObject(value, depth = 0) {
  if (depth > 10 || !isObject(value)) return null;

  const keys = Object.keys(value);
  const numericKeys = keys.filter(key => /^\d+$/.test(key));
  if (numericKeys.length >= 2 && numericKeys.every(key => isObject(value[key]) || Array.isArray(value[key]))) {
    return numericKeys.sort((a, b) => Number(a) - Number(b)).map(key => value[key]);
  }

  for (const key of ["result", "data", "leaderboard", "rankings", "entries", "values"]) {
    const child = value[key];
    if (isObject(child)) {
      const found = findLeaderboardObject(child, depth + 1);
      if (found) return found;
    }
  }

  for (const child of Object.values(value)) {
    const found = findLeaderboardObject(child, depth + 1);
    if (found) return found;
  }

  return null;
}

function getNested(item, keys) {
  if (!isObject(item)) return null;
  for (const key of keys) {
    const wanted = keyName(key);
    for (const [actual, value] of Object.entries(item)) {
      if (keyName(actual) === wanted && value !== null && value !== undefined && value !== "") return value;
    }
  }

  for (const nestedKey of ["stats", "statistics", "playerStats", "player", "data"]) {
    if (isObject(item[nestedKey])) {
      const nested = getNested(item[nestedKey], keys);
      if (nested !== null && nested !== undefined && nested !== "") return nested;
    }
  }

  return null;
}

function normalizePlaytime(item) {
  const formatted = getNested(item, ["formattedPlaytime", "formattedPlayTime", "playtimeFormatted", "displayPlaytime", "displayTime"]);
  if (formatted !== null) return String(formatted);

  const hours = numeric(getNested(item, ["hours", "playtimeHours", "totalHours"]));
  if (hours !== null) return `${hours} h`;

  const minutes = numeric(getNested(item, ["minutes", "playtimeMinutes", "totalMinutes"]));
  if (minutes !== null) return `${minutes} min`;

  const value = getNested(item, ["playtime", "playTime", "totalPlaytime", "total_playtime", "gameTime", "timePlayed", "value"]);
  if (isObject(value)) {
    const nestedFormatted = getNested(value, ["formatted", "display", "text"]);
    if (nestedFormatted !== null) return String(nestedFormatted);
    const nestedHours = numeric(getNested(value, ["hours"]));
    if (nestedHours !== null) return `${nestedHours} h`;
    const nestedMinutes = numeric(getNested(value, ["minutes"]));
    if (nestedMinutes !== null) return `${nestedMinutes} min`;
  }

  return value ?? null;
}

function normalizeLeaderboard(data, kind) {
  const root = data?.response ?? data;
  let rows = findArray(root, ["result", "results", "leaderboard", "rankings", kind, "entries", "players", "items", "data"]);
  if (!rows) rows = findLeaderboardObject(root);
  if (!Array.isArray(rows)) return [];

  return rows.map((item, index) => {
    if (!isObject(item)) return { rank: index + 1, name: String(item), value: null };

    const rank = numeric(getNested(item, ["rank", "position", "place", "index"])) ?? index + 1;
    const name = getNested(item, [
      "name", "playerName", "player_name", "username", "displayName",
      "steamName", "characterName", "player", "survivor"
    ]);

    const value = kind === "kills"
      ? getNested(item, ["kills", "totalKills", "killCount", "killsCount", "playerKills", "value", "score"])
      : normalizePlaytime(item);

    return {
      rank,
      name: name !== null ? String(name) : "Unknown Survivor",
      value: value === null || value === undefined ? "—" : String(value)
    };
  }).filter(row => row.name && row.name !== "Unknown Survivor" || row.value !== "—");
}

async function fetchLeaderboard(env, kind) {
  if (!env.PRISONER_API_TOKEN) {
    return { ok: false, status: 503, endpoint: `/leaderboard/${kind}`, leaderboard: [], error: "Prisoner Bot not configured" };
  }

  const endpoint = `/leaderboard/${kind}`;
  try {
    const response = await fetch(new URL(endpoint, PRISONER_BASE), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "PRISONER-BOT-TOKEN": env.PRISONER_API_TOKEN
      },
      cf: { cacheTtl: 5, cacheEverything: false }
    });

    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    if (!response.ok) {
      return { ok: false, status: response.status, endpoint, leaderboard: [], error: `HTTP ${response.status}` };
    }

    const leaderboard = normalizeLeaderboard(data, kind);
    return {
      ok: true,
      status: response.status,
      source: "Prisoner Bot Public API",
      endpoint,
      type: kind,
      count: leaderboard.length,
      leaderboard
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      endpoint,
      leaderboard: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function looksLikeKill(value) {
  if (!isObject(value)) return false;
  const killer = getNested(value, ["killerName", "killer", "killerPlayer", "attackerName", "attacker"]);
  const victim = getNested(value, ["victimName", "victim", "victimPlayer", "targetName", "target"]);
  return killer !== null && victim !== null;
}

function collectKillEvents(value, output = [], seen = new Set(), depth = 0) {
  if (depth > 10 || value == null) return output;

  if (Array.isArray(value)) {
    for (const item of value) collectKillEvents(item, output, seen, depth + 1);
    return output;
  }

  if (!isObject(value)) return output;

  if (looksLikeKill(value)) {
    const id = String(getNested(value, ["id", "eventId", "killId"]) ?? "");
    const timestamp = String(getNested(value, ["timestamp", "time", "createdAt", "date"]) ?? "");
    const killer = String(getNested(value, ["killerName", "killer", "killerPlayer", "attackerName", "attacker"]));
    const victim = String(getNested(value, ["victimName", "victim", "victimPlayer", "targetName", "target"]));
    const killerSteamId = getNested(value, ["killerSteamId", "killerSteamID", "killer_steam_id", "attackerSteamId"]);
    const victimSteamId = getNested(value, ["victimSteamId", "victimSteamID", "victim_steam_id", "targetSteamId"]);
    const dedupe = id || `${timestamp}|${killer}|${victim}|${killerSteamId ?? ""}|${victimSteamId ?? ""}`;
    if (!seen.has(dedupe)) {
      seen.add(dedupe);
      output.push({ id: id || dedupe, timestamp: timestamp || null, killerName: killer, victimName: victim, killerSteamId: killerSteamId ? String(killerSteamId) : null, victimSteamId: victimSteamId ? String(victimSteamId) : null });
    }
    return output;
  }

  for (const child of Object.values(value)) {
    collectKillEvents(child, output, seen, depth + 1);
  }
  return output;
}

async function loadKillFallback(env) {
  if (!env.KILLFEED_KV) return [];

  try {
    const listed = await env.KILLFEED_KV.list({ limit: 1000 });
    const events = [];
    const seen = new Set();

    for (const key of listed.keys ?? []) {
      try {
        const raw = await env.KILLFEED_KV.get(key.name);
        if (!raw) continue;
        let parsed;
        try { parsed = JSON.parse(raw); } catch { continue; }
        collectKillEvents(parsed, events, seen);
      } catch {}
    }

    const totals = new Map();
    for (const event of events) {
      const steamKey = event.killerSteamId ? `steam:${event.killerSteamId}` : null;
      const nameKey = `name:${String(event.killerName).toLowerCase()}`;
      const key = steamKey || nameKey;
      const current = totals.get(key) ?? { name: event.killerName, steamId: event.killerSteamId, kills: 0 };
      current.kills += 1;
      if (!current.name && event.killerName) current.name = event.killerName;
      totals.set(key, current);
    }

    return [...totals.values()]
      .sort((a, b) => b.kills - a.kills || String(a.name).localeCompare(String(b.name)))
      .slice(0, KILL_LIMIT)
      .map((row, index) => ({ rank: index + 1, name: row.name, value: String(row.kills) }));
  } catch {
    return [];
  }
}

async function loadPlaytimeFallback(env) {
  if (!env.PRISONER_API_TOKEN) return [];

  try {
    const response = await fetch(new URL("/players", PRISONER_BASE), {
      method: "GET",
      headers: { Accept: "application/json", "PRISONER-BOT-TOKEN": env.PRISONER_API_TOKEN },
      cf: { cacheTtl: 5, cacheEverything: false }
    });
    if (!response.ok) return [];
    const data = await response.json();
    const root = data?.response ?? data;
    const rows = findArray(root, ["players", "entries", "items", "results", "data", "records"]) || [];

    return rows.map(item => ({
      name: getNested(item, ["name", "playerName", "player_name", "username", "displayName", "steamName"]),
      value: normalizePlaytime(item)
    }))
      .filter(row => row.name && row.value !== null && row.value !== undefined && row.value !== "—")
      .sort((a, b) => String(a.value).localeCompare(String(b.value), undefined, { numeric: true }))
      .reverse()
      .slice(0, KILL_LIMIT)
      .map((row, index) => ({ rank: index + 1, name: String(row.name), value: String(row.value) }));
  } catch {
    return [];
  }
}

async function getLeaderboard(env, kind) {
  const primary = await fetchLeaderboard(env, kind);

  if (primary.ok && primary.leaderboard.length > 0) {
    return primary;
  }

  if (kind === "kills") {
    const fallback = await loadKillFallback(env);
    if (fallback.length > 0) {
      return {
        ok: true,
        status: 200,
        source: "Shadow Forge KILLFEED_KV fallback",
        primarySource: "Prisoner Bot Public API",
        primaryCount: primary.leaderboard?.length ?? 0,
        endpoint: primary.endpoint,
        type: kind,
        count: fallback.length,
        leaderboard: fallback
      };
    }
  }

  if (kind === "playtime") {
    const fallback = await loadPlaytimeFallback(env);
    if (fallback.length > 0) {
      return {
        ok: true,
        status: 200,
        source: "Prisoner Bot /players fallback",
        primarySource: "Prisoner Bot Public API",
        primaryCount: primary.leaderboard?.length ?? 0,
        endpoint: primary.endpoint,
        type: kind,
        count: fallback.length,
        leaderboard: fallback
      };
    }
  }

  return primary;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return json({ ok: true });

    if (url.pathname === "/api/leaderboard") {
      const kind = url.searchParams.get("type") === "playtime" ? "playtime" : "kills";
      const cache = caches.default;
      const cacheKey = new Request(`https://shadow-forge-leaderboard-cache.invalid/${kind}`);
      const hit = await cache.match(cacheKey);
      if (hit) {
        try {
          const stored = Number(hit.headers.get("X-SF-Leaderboard-Stored") || 0);
          if (stored && Date.now() - stored < LEADERBOARD_CACHE_MS) return hit;
        } catch {}
      }

      const result = await getLeaderboard(env, kind);
      const response = json(result, result.ok ? 200 : result.status || 502);
      const headers = new Headers(response.headers);
      headers.set("X-SF-Leaderboard-Stored", String(Date.now()));
      await cache.put(cacheKey, new Response(JSON.stringify(result), { status: response.status, headers }));
      return response;
    }

    return baseWorker.fetch(request, env, ctx);
  }
};
