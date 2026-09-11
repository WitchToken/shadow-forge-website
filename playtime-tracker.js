import leaderboardWorker from "./leaderboard-worker.js";

const PRISONER_BASE = "https://scum.theprisonerbot.com/api";
const TRACK_PREFIX = "playtime:";
const META_KEY = "playtime:_meta";
const MAX_DELTA_SECONDS = 10 * 60;
const TOP_LIMIT = 10;

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

function isObject(v) { return v && typeof v === "object" && !Array.isArray(v); }

function parseRconPlayers(data) {
  const result = Array.isArray(data?.results) ? data.results[0] : null;
  const output = Array.isArray(result?.output) ? result.output : [];
  const players = [];
  const pattern = /^\s*\d+\.\s*(.*?)\s*\((\d{10,20})\)\s*$/;

  for (const raw of output) {
    const line = String(raw ?? "").trim();
    if (!line) continue;
    const match = line.match(pattern);
    if (match) {
      players.push({ name: match[1].trim(), steamId: match[2] });
      continue;
    }
    const steamMatch = line.match(/(\d{10,20})/);
    if (steamMatch) {
      const name = line
        .replace(/^\s*\d+\.\s*/, "")
        .replace(/\s*\(\d{10,20}\).*$/, "")
        .trim();
      if (name) players.push({ name, steamId: steamMatch[1] });
    }
  }
  return { ok: Boolean(result?.ok) && !result?.error, players };
}

async function getOnlinePlayers(env) {
  if (!env.PRISONER_API_TOKEN) return { ok: false, players: [], error: "PRISONER_API_TOKEN fehlt" };
  try {
    const response = await fetch(`${PRISONER_BASE}/public/command/send`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "PRISONER-BOT-TOKEN": env.PRISONER_API_TOKEN
      },
      body: JSON.stringify({ commands: ["#ListPlayers"] })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, players: [], error: `HTTP ${response.status}` };
    return parseRconPlayers(data);
  } catch (error) {
    return { ok: false, players: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function formatPlaytime(seconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function trackPlaytime(env) {
  if (!env.KILLFEED_KV) return { ok: false, tracked: 0, error: "KILLFEED_KV fehlt" };
  const online = await getOnlinePlayers(env);
  if (!online.ok) return { ok: false, tracked: 0, error: online.error };

  const now = Date.now();
  let tracked = 0;

  for (const player of online.players) {
    const steamId = String(player.steamId || "").trim();
    const name = String(player.name || "").trim();
    if (!steamId && !name) continue;

    const keyId = steamId || encodeURIComponent(name.toLowerCase());
    const key = `${TRACK_PREFIX}${keyId}`;
    let record = null;
    try { record = await env.KILLFEED_KV.get(key, "json"); } catch {}

    if (!isObject(record)) {
      record = { steamId: steamId || null, name, seconds: 0, lastSeen: now };
    } else {
      const previous = Number(record.lastSeen) || now;
      const delta = Math.min(MAX_DELTA_SECONDS, Math.max(0, Math.floor((now - previous) / 1000)));
      record.seconds = Math.max(0, Number(record.seconds) || 0) + delta;
      record.lastSeen = now;
      if (steamId) record.steamId = steamId;
      if (name) record.name = name;
    }

    await env.KILLFEED_KV.put(key, JSON.stringify(record));
    tracked += 1;
  }

  await env.KILLFEED_KV.put(META_KEY, JSON.stringify({ lastRun: now, online: online.players.length }));
  return { ok: true, tracked, online: online.players.length, timestamp: new Date(now).toISOString() };
}

async function loadTrackedPlaytime(env) {
  if (!env.KILLFEED_KV) return [];
  try {
    const listed = await env.KILLFEED_KV.list({ prefix: TRACK_PREFIX, limit: 1000 });
    const rows = [];
    for (const key of listed.keys ?? []) {
      if (key.name === META_KEY) continue;
      const value = await env.KILLFEED_KV.get(key.name, "json").catch(() => null);
      if (!isObject(value)) continue;
      const seconds = Number(value.seconds) || 0;
      if (seconds <= 0 || !value.name) continue;
      rows.push({ name: String(value.name), value: formatPlaytime(seconds), seconds });
    }
    rows.sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
    return rows.slice(0, TOP_LIMIT).map((row, index) => ({ rank: index + 1, name: row.name, value: row.value }));
  } catch {
    return [];
  }
}

async function handleLeaderboard(request, env) {
  const baseResponse = await leaderboardWorker.fetch(request, env);
  if (new URL(request.url).searchParams.get("type") !== "playtime") return baseResponse;

  let body = null;
  try { body = await baseResponse.clone().json(); } catch {}
  if (body?.ok && Array.isArray(body.leaderboard) && body.leaderboard.length > 0) return baseResponse;

  const fallback = await loadTrackedPlaytime(env);
  if (!fallback.length) return baseResponse;

  return json({
    ok: true,
    source: "Shadow Forge Playtime Tracker",
    primarySource: "Prisoner Bot Public API",
    type: "playtime",
    count: fallback.length,
    leaderboard: fallback
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json({ ok: true });
    if (url.pathname === "/api/leaderboard") return handleLeaderboard(request, env);
    if (url.pathname === "/api/playtime/status") {
      const tracked = await loadTrackedPlaytime(env);
      const meta = env.KILLFEED_KV ? await env.KILLFEED_KV.get(META_KEY, "json").catch(() => null) : null;
      return json({ ok: true, source: "Shadow Forge Playtime Tracker", count: tracked.length, lastRun: meta?.lastRun ? new Date(meta.lastRun).toISOString() : null, leaderboard: tracked });
    }
    return leaderboardWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(trackPlaytime(env));
  }
};
