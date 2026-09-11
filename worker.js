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

const LIVE_CACHE_MS = 10_000;
const RCON_LIVE_CACHE_MS = 8_000;
const LEADERBOARD_CACHE_MS = 30_000;
const KILLFEED_LIMIT = 40;
const KILLFEED_TTL_SECONDS = 60 * 60 * 24 * 7;

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
  const playersUrl = `${serverUrl}/players`;
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



async function prisonerCommand(env, commands) {
  if (!env.PRISONER_API_TOKEN) {
    return { ok: false, status: 503, responseMs: 0, data: null, error: "Prisoner Bot not configured" };
  }
  const started = Date.now();
  try {
    const response = await fetch(`${PRISONER_BASE}/public/command/send`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "PRISONER-BOT-TOKEN": env.PRISONER_API_TOKEN
      },
      body: JSON.stringify({ commands })
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

function parseRconPlayers(data) {
  const result = Array.isArray(data?.results) ? data.results[0] : null;
  const output = Array.isArray(result?.output) ? result.output : [];
  const players = [];
  const pattern = /^\\s*\\d+\\.\\s*(.*?)\\s*\\((\\d{10,20})\\)\\s*$/;

  for (const raw of output) {
    const line = String(raw ?? "").trim();
    if (!line) continue;
    const match = line.match(pattern);
    if (match) {
      players.push({
        id: players.length + 1,
        name: match[1].trim(),
        steamId: match[2],
        ping: null
      });
      continue;
    }

    // Fallback parser for slightly different SCUM/RCON formatting.
    const steamMatch = line.match(/(\\d{10,20})/);
    if (steamMatch) {
      const before = line
        .replace(/^\\s*\\d+\\.\\s*/, "")
        .replace(/\\s*\\(\\d{10,20}\\).*$/, "")
        .trim();
      if (before) {
        players.push({
          id: players.length + 1,
          name: before,
          steamId: steamMatch[1],
          ping: null
        });
      }
    }
  }

  return {
    ok: Boolean(result?.ok) && !result?.error,
    playerOnline: result?.playerOnline ?? null,
    error: result?.error ?? null,
    errorMessage: result?.errorMessage ?? null,
    rawOutput: output,
    players
  };
}

async function prisonerLivePlayers(env) {
  return cachedJson("prisoner-rcon-players", async () => {
    const result = await prisonerCommand(env, ["#ListPlayers"]);
    const parsed = result.ok ? parseRconPlayers(result.data) : {
      ok: false,
      playerOnline: null,
      error: result.error,
      errorMessage: result.error,
      rawOutput: [],
      players: []
    };
    return {
      ok: result.ok && parsed.ok,
      source: "Prisoner Bot Public API → RCON",
      command: "#ListPlayers",
      responseMs: result.responseMs,
      transport: result.data?.transport ?? null,
      playerOnline: parsed.playerOnline,
      error: parsed.error,
      errorMessage: parsed.errorMessage,
      count: parsed.players.length,
      players: parsed.players
    };
  }, RCON_LIVE_CACHE_MS);
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

function mergeLive(gm, gs4u, prisonerServer, prisonerPlayers, prisonerLive, kills, playtime) {
  const pServer = prisonerServer?.ok ? normalizeServer(prisonerServer.data) : null;
  const dbPlayers = prisonerPlayers?.ok ? normalizePlayers(prisonerPlayers.data) : [];
  const gmServer = gm?.ok ? gm.server : null;
  const gmPlayers = gm?.players ?? [];
  const rconPlayers = prisonerLive?.ok ? (prisonerLive.players ?? []) : [];
  const gServer = gs4u?.ok ? gs4u.server : null;

  const online = gm?.ok
    ? gmServer?.online !== false
    : gs4u?.ok
      ? gServer?.online !== false
      : pServer?.online === true;

  const currentPlayers = rconPlayers.length > 0
    ? rconPlayers.length
    : (prisonerLive?.ok && prisonerLive.count === 0
      ? 0
      : numeric(gmServer?.players) ?? numeric(gServer?.players) ?? numeric(pServer?.players));
  const version = gmServer?.version || pServer?.version || null;
  const ping = numeric(gm?.responseMs);
  const playerList = prisonerLive?.ok ? rconPlayers : (gm?.playersOk ? gmPlayers : []);
  const source = prisonerLive?.ok ? "Prisoner Bot RCON" : gm?.ok ? "GAMEMONITORING" : gs4u?.ok ? "GS4u Live Monitor" : pServer ? "Prisoner Bot" : "Nicht verfügbar";

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
    playerListSource: prisonerLive?.ok ? "Prisoner Bot RCON" : gm?.playersOk ? "GAMEMONITORING" : "Keine Live-Namensquelle",
    liveSource: source,
    leaderboards: {
      kills: kills?.ok ? normalizeLeaderboard(kills.data, "kills") : [],
      playtime: playtime?.ok ? normalizeLeaderboard(playtime.data, "playtime") : []
    }
  };
}


function pickFirst(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return null;
}

function normalizeKill(payload) {
  const root = payload?.data ?? payload?.kill ?? payload?.event ?? payload?.payload ?? payload;
  const killer = root?.killer ?? root?.attacker ?? root?.killerPlayer ?? {};
  const victim = root?.victim ?? root?.target ?? root?.victimPlayer ?? {};
  const killerName = pickFirst(killer, ["name","playerName","scumName"]) ?? pickFirst(root, ["killerName","attackerName","killer","player"]) ?? null;
  const victimName = pickFirst(victim, ["name","playerName","scumName"]) ?? pickFirst(root, ["victimName","targetName","victim","target"]) ?? null;
  const weapon = pickFirst(root, ["weapon","weaponName","weapon_name"]) ?? pickFirst(killer, ["weapon","weaponName"]);
  const sector = pickFirst(root, ["sector","mapSector","zone","location","map"]);
  const timestamp = pickFirst(root, ["timestamp","createdAt","date","time","occurredAt"]) ?? new Date().toISOString();
  const npc = !victimName || /zombie|animal|bear|wolf|boar|horse|npc/i.test(String(victimName));
  return {
    id: String(pickFirst(root, ["id","killId","eventId"]) ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    timestamp: String(timestamp),
    killerName: killerName ? String(killerName) : "Unknown",
    victimName: victimName ? String(victimName) : "Unknown",
    killerSteamId: pickFirst(killer, ["steamId","steamID","steam_id"]) ?? pickFirst(root, ["killerSteamId","attackerSteamId"]),
    victimSteamId: pickFirst(victim, ["steamId","steamID","steam_id"]) ?? pickFirst(root, ["victimSteamId","targetSteamId"]),
    weapon: weapon ? String(weapon) : null,
    sector: sector ? String(sector) : null,
    npc
  };
}

async function readKillfeed(env) {
  if (!env.KILLFEED_KV) return [];
  try {
    const value = await env.KILLFEED_KV.get("kills", "json");
    return Array.isArray(value) ? value.slice(0, KILLFEED_LIMIT) : [];
  } catch { return []; }
}

async function writeKillfeed(env, kill) {
  if (!env.KILLFEED_KV) return { ok: false, error: "KILLFEED_KV not configured" };
  const existing = await readKillfeed(env);
  const next = [kill, ...existing.filter(item => item?.id !== kill.id)].slice(0, KILLFEED_LIMIT);
  await env.KILLFEED_KV.put("kills", JSON.stringify(next), { expirationTtl: KILLFEED_TTL_SECONDS });
  return { ok: true, count: next.length };
}

async function handleKillWebhook(request, env, pathSecret = null) {
  const secret = env.KILLFEED_WEBHOOK_SECRET;
  if (secret) {
    const provided = request.headers.get("X-Shadow-Forge-Webhook") || request.headers.get("X-Webhook-Secret") || "";
    const authenticatedByPath = pathSecret === secret;
    if (!authenticatedByPath && provided !== secret) return json({ ok: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const kill = normalizeKill(body);
  const stored = await writeKillfeed(env, kill);
  if (!stored.ok) return json({ ok: false, kill, error: stored.error }, 503);
  return json({ ok: true, kill, count: stored.count });
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
        service: "shadow-forge-live-api-v5-rcon-killfeed",
        timestamp: new Date().toISOString(),
        integrations: {
          gameMonitoring: true,
          gameMonitoringServerId: GAMEMONITORING_SERVER_ID,
          prisonerBot: Boolean(env.PRISONER_API_TOKEN),
          prisonerRconLivePlayers: Boolean(env.PRISONER_API_TOKEN),
          killfeedWebhook: Boolean(env.KILLFEED_KV),
          killfeedWebhookSecret: Boolean(env.KILLFEED_WEBHOOK_SECRET),
          gs4uLiveFallback: true
        }
      });
    }

    if (url.pathname === "/api/killfeed") {
      const kills = await readKillfeed(env);
      return json({ ok: true, source: env.KILLFEED_KV ? "Prisoner Bot Webhook → Cloudflare KV" : "not configured", count: kills.length, kills });
    }

    if ((url.pathname === "/api/webhooks/prisoner/kill" || url.pathname.startsWith("/api/webhooks/prisoner/kill/")) && request.method === "POST") {
      const configuredSecret = env.KILLFEED_WEBHOOK_SECRET;
      const prefix = "/api/webhooks/prisoner/kill/";
      const pathSecret = url.pathname.startsWith(prefix) ? decodeURIComponent(url.pathname.slice(prefix.length)) : null;
      if (configuredSecret && pathSecret && pathSecret !== configuredSecret) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      return handleKillWebhook(request, env, pathSecret);
    }

    if (url.pathname === "/api/live") {
      return cachedJson("live-v5", async () => {
        const started = Date.now();
        const [gm, gs4u, prisonerServer, prisonerPlayers, prisonerLive, kills, playtime] = await Promise.all([
          gameMonitoringFetch(),
          gs4uFetch(),
          prisonerFetch(env, PATHS.server),
          prisonerFetch(env, PATHS.players),
          prisonerLivePlayers(env),
          prisonerFetch(env, PATHS.kills),
          prisonerFetch(env, PATHS.playtime)
        ]);
        const server = mergeLive(gm, gs4u, prisonerServer, prisonerPlayers, prisonerLive, kills, playtime);
        return {
          ok: Boolean(prisonerLive.ok || gm.ok || gs4u.ok || prisonerServer.ok || prisonerPlayers.ok),
          timestamp: new Date().toISOString(),
          responseMs: Date.now() - started,
          server,
          sources: {
            gameMonitoring: { ok: Boolean(gm.ok), playersOk: Boolean(gm.playersOk), responseMs: gm.responseMs },
            gs4u: Boolean(gs4u.ok),
            prisonerBot: Boolean(prisonerServer.ok || prisonerPlayers.ok || prisonerLive.ok || kills.ok || playtime.ok),
            prisonerRcon: { ok: Boolean(prisonerLive.ok), responseMs: prisonerLive.responseMs, count: prisonerLive.count ?? null, error: prisonerLive.error ?? null }
          }
        };
      }, LIVE_CACHE_MS);
    }

    if (url.pathname === "/api/rcon-players") {
      const result = await prisonerLivePlayers(env);
      return json(result);
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
      const result = await prisonerLivePlayers(env);
      return json({
        ok: result.ok,
        source: result.source,
        count: result.count,
        players: result.players,
        error: result.error ?? null,
        errorMessage: result.errorMessage ?? null
      });
    }

    if (!url.pathname.startsWith("/api/") && env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Shadow Forge Live API", { status: 404, headers: { ...corsHeaders(), "Content-Type": "text/plain; charset=UTF-8" } });
  }
};
