const BASE = "https://scum.theprisonerbot.com/api";

const PATHS = {
  server: "/server",
  rconServerInfo: "/admin/rcon-dashboard/server-info",
  rconStatus: "/admin/rcon-dashboard/status",
  players: "/players",
  kills: "/leaderboard/kills",
  playtime: "/leaderboard/playtime"
};

// Public-API route candidates for live/server monitoring.
// V2 discovery records response metadata and a SAFE preview only.
// It never returns Authorization headers, tokens, cookies, or full HTML.
const DISCOVERY_PATHS = [
  "/server/status",
  "/server/players",
  "/server/online",
  "/server/online-players",
  "/server/player-list",
  "/server/live",
  "/server/live-status",
  "/players/online",
  "/players/online-list",
  "/players/current",
  "/players/active",
  "/players/live",
  "/online",
  "/online-players",
  "/online_players",
  "/status",
  "/status/server",
  "/monitoring/status",
  "/monitoring/players",
  "/monitoring/online-players"
];

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

function safePreview(text, max = 500) {
  if (!text) return "";
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/PRISONER-BOT-TOKEN["'\s:=]+[^"'\s,}]+/gi, "PRISONER-BOT-TOKEN=[REDACTED]")
    .replace(/Authorization["'\s:=]+[^"'\s,}]+/gi, "Authorization=[REDACTED]")
    .replace(/cookie["'\s:=]+[^"'\s,}]+/gi, "cookie=[REDACTED]")
    .slice(0, max);
}

async function prisonerFetch(env, path, query = "") {
  if (!env.PRISONER_API_TOKEN) throw new Error("PRISONER_API_TOKEN fehlt");

  const target = new URL(path, BASE);
  if (query) target.search = query;

  const isRconDashboard = path.startsWith("/admin/rcon-dashboard/");
  const headers = {
    "Accept": "application/json"
  };

  if (isRconDashboard) {
    // Admin RCON dashboard authentication.
    // NEVER expose this secret in a response.
    headers["Authorization"] = `Bearer ${env.PRISONER_API_TOKEN}`;
  } else {
    headers["PRISONER-BOT-TOKEN"] = env.PRISONER_API_TOKEN;
  }

  const response = await fetch(target, {
    method: "GET",
    headers
  });

  const contentType = response.headers.get("content-type") || "";
  const finalUrl = response.url || target.toString();
  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 4000) };
  }

  return {
    ok: response.ok,
    status: response.status,
    endpoint: path,
    contentType,
    finalUrl,
    data: body,
    rawText: text
  };
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
    "players", "leaderboard", "rankings", "items", "results",
    "rows", "data", "entries", "records"
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

function findScalar(value, keys, depth = 0) {
  if (depth > 12 || value == null) return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findScalar(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (!isObject(value)) return undefined;

  const normalized = Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      String(k).toLowerCase().replace(/[^a-z0-9]/g, ""),
      v
    ])
  );

  for (const key of keys) {
    const nk = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalized[nk] !== undefined && normalized[nk] !== null) {
      return normalized[nk];
    }
  }

  for (const key of Object.keys(value)) {
    const found = findScalar(value[key], keys, depth + 1);
    if (found !== undefined) return found;
  }

  return undefined;
}

function findNumeric(value, keys, depth = 0) {
  const raw = findScalar(value, keys, depth);
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (
    typeof raw === "string" &&
    raw.trim() !== "" &&
    Number.isFinite(Number(raw))
  ) {
    return Number(raw);
  }
  return undefined;
}

function findValueByKey(value, keys, depth = 0) {
  if (depth > 12 || value == null) return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValueByKey(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (!isObject(value)) return undefined;

  const normalized = Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      String(k).toLowerCase().replace(/[^a-z0-9]/g, ""),
      v
    ])
  );

  for (const key of keys) {
    const nk = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalized[nk] !== undefined) return normalized[nk];
  }

  for (const key of Object.keys(value)) {
    const found = findValueByKey(value[key], keys, depth + 1);
    if (found !== undefined) return found;
  }

  return undefined;
}

function countOnlinePlayers(data) {
  const explicit = findNumeric(data, [
    "onlinePlayers",
    "playersOnline",
    "onlineCount",
    "playerCount",
    "currentPlayers",
    "currentPlayerCount",
    "connectedPlayers",
    "players_online",
    "players_online_count"
  ]);

  if (explicit !== undefined) return explicit;

  const playersNode = findValueByKey(data, [
    "players",
    "playerData",
    "playerStats"
  ]);

  if (playersNode !== undefined) {
    if (Array.isArray(playersNode)) return playersNode.length;

    const nested = findNumeric(playersNode, [
      "online",
      "count",
      "current",
      "connected",
      "totalOnline"
    ]);

    if (nested !== undefined) return nested;
  }

  const arr = findArray(data, [
    "onlinePlayers",
    "players",
    "items",
    "entries",
    "results",
    "data"
  ]);

  if (arr) return arr.length;

  return undefined;
}

function normalizeServer(data) {
  const players = countOnlinePlayers(data);
  const maxPlayers = findNumeric(data, [
    "maxPlayers",
    "maxPlayerCount",
    "maxSlots",
    "slots",
    "capacity"
  ]);

  const statusRaw = findScalar(data, [
    "status",
    "serverStatus",
    "state"
  ]);

  const onlineRaw = findScalar(data, [
    "online",
    "isOnline",
    "serverOnline",
    "isRunning"
  ]);

  const status =
    typeof statusRaw === "string" ? statusRaw.toLowerCase() : "";

  let online;

  if (typeof onlineRaw === "boolean") {
    online = onlineRaw;
  } else if (status) {
    online = ![
      "offline",
      "down",
      "stopped",
      "unavailable",
      "maintenance"
    ].includes(status);
  } else {
    online = true;
  }

  return {
    online,
    players: players ?? null,
    maxPlayers: maxPlayers ?? null,
    status: statusRaw ?? null
  };
}

function playerName(x) {
  return (
    x?.name ??
    x?.player ??
    x?.playerName ??
    x?.username ??
    x?.steamName ??
    x?.displayName ??
    "Player"
  );
}

function rankingValue(x, kind) {
  if (kind === "kills") {
    return (
      x?.kills ??
      x?.killCount ??
      x?.killsCount ??
      x?.value ??
      x?.score ??
      "—"
    );
  }

  return (
    x?.playtime ??
    x?.playTime ??
    x?.totalPlaytime ??
    x?.hours ??
    x?.minutes ??
    x?.value ??
    "—"
  );
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

  if (arr) return arr;

  const node = findValueByKey(data, [
    "player",
    "onlinePlayer",
    "currentPlayer"
  ]);

  if (isObject(node)) return [node];

  return [];
}

function normalizeLeaderboard(data, kind) {
  return (
    findArray(data, [
      "leaderboard",
      "rankings",
      kind,
      "entries",
      "players"
    ]) || []
  );
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
        endpoints: PATHS,
        discovery_v2: "/api/public-discovery-v2"
      });
    }

    // ============================================================
    // PUBLIC API DISCOVERY V2
    // Shows response metadata + a small sanitized response preview.
    // This is for finding the REAL live-player Public API route.
    // ============================================================
    if (url.pathname === "/api/public-discovery-v2") {
      const results = [];

      for (const path of DISCOVERY_PATHS) {
        try {
          const result = await prisonerFetch(env, path);

          let parsedJson = false;
          let jsonKeys = [];
          let jsonType = null;

          if (isObject(result.data) || Array.isArray(result.data)) {
            parsedJson = !("raw" in result.data);
            jsonType = Array.isArray(result.data)
              ? "array"
              : typeof result.data;

            if (isObject(result.data)) {
              jsonKeys = Object.keys(result.data).slice(0, 30);
            }
          }

          const rawPreview =
            result.data?.raw !== undefined
              ? safePreview(result.rawText, 500)
              : "";

          const lower = result.rawText.toLowerCase();

          results.push({
            path,
            status: result.status,
            ok: result.ok,
            content_type: result.contentType,
            final_url: result.finalUrl,
            parsed_json: parsedJson,
            json_type: jsonType,
            json_keys: jsonKeys,
            raw_length: result.rawText.length,
            raw_preview: rawPreview,
            looks_like_html:
              lower.includes("<html") ||
              lower.includes("<!doctype"),
            looks_like_nuxt:
              lower.includes("__nuxt") ||
              lower.includes("nuxt"),
            looks_like_error:
              lower.includes("error") ||
              lower.includes("not found") ||
              lower.includes("unauthorized") ||
              lower.includes("forbidden"),
            player_keywords: [
              "player",
              "players",
              "online",
              "steamid",
              "steam_id",
              "playerlist",
              "player_list"
            ].filter((word) => lower.includes(word))
          });
        } catch (e) {
          results.push({
            path,
            ok: false,
            error: e?.message || String(e)
          });
        }
      }

      return json({
        ok: true,
        source: "Prisoner Bot Public API discovery V2",
        note:
          "Safe response previews only. Secrets and authorization headers are never returned.",
        tested: DISCOVERY_PATHS.length,
        results
      });
    }


    // ============================================================
    // PUBLIC API DISCOVERY V3
    // The guessed Public API paths above all redirect to the Nuxt
    // Admin Panel. V3 follows that redirect, reads the panel HTML,
    // finds its Nuxt JS bundles, and safely extracts endpoint-like
    // strings from those bundles.
    //
    // It NEVER returns tokens, Authorization headers, cookies,
    // localStorage values, or full HTML/JS.
    // ============================================================
    if (url.pathname === "/api/public-discovery-v3") {
      try {
        const panelUrl = "https://scumpanel.theprisonerbot.com/";
        const panelResponse = await fetch(panelUrl, {
          method: "GET",
          headers: { "Accept": "text/html" }
        });

        const html = await panelResponse.text();

        // Extract Nuxt JS asset URLs from the panel HTML.
        const assetMatches = [
          ...html.matchAll(/(?:src|href)="([^"]+\.js(?:\?[^"]*)?)"/gi)
        ];

        const assetUrls = [];
        for (const match of assetMatches) {
          let asset = match[1];
          if (asset.startsWith("/")) {
            asset = new URL(asset, panelUrl).toString();
          } else if (!asset.startsWith("http")) {
            asset = new URL(asset, panelUrl).toString();
          }

          if (!assetUrls.includes(asset)) {
            assetUrls.push(asset);
          }
        }

        // Limit work to the first 20 JS bundles.
        const selectedAssets = assetUrls.slice(0, 20);
        const bundles = [];

        const interestingPatterns = [
          /\/api\/[A-Za-z0-9_./?=&${}:-]+/g,
          /admin\/rcon-dashboard\/[A-Za-z0-9_./?=&${}:-]+/g,
          /rcon-dashboard[A-Za-z0-9_./?=&${}:-]*/g,
          /(?:server|player|players|online|status|monitoring)[A-Za-z0-9_./?=&${}:-]{0,100}/gi
        ];

        for (const assetUrl of selectedAssets) {
          try {
            const jsResponse = await fetch(assetUrl, {
              method: "GET",
              headers: { "Accept": "application/javascript,text/javascript,*/*" }
            });

            const jsText = await jsResponse.text();
            const found = new Set();

            for (const pattern of interestingPatterns) {
              const matches = jsText.match(pattern) || [];
              for (const item of matches) {
                const clean = item
                  .replace(/[\\"'`;,)\]}]+$/g, "")
                  .trim();

                if (
                  clean.length >= 4 &&
                  clean.length <= 220 &&
                  !/password|token|authorization|cookie|localstorage|sessionstorage/i.test(clean)
                ) {
                  found.add(clean);
                }
              }
            }

            bundles.push({
              asset: assetUrl,
              status: jsResponse.status,
              content_type: jsResponse.headers.get("content-type") || "",
              bytes: jsText.length,
              matches: [...found].slice(0, 250)
            });
          } catch (e) {
            bundles.push({
              asset: assetUrl,
              ok: false,
              error: e?.message || String(e)
            });
          }
        }

        // Also look for the API base URL without exposing page contents.
        const apiBaseCandidates = [
          ...html.matchAll(/https?:\/\/[^"'`\s<>]+\/api(?:\/[^"'`\s<>]*)?/gi)
        ].map(m => m[0].replace(/[\\'"`),;]+$/g, ""));

        return json({
          ok: true,
          source: "Prisoner Bot Admin Panel bundle discovery V3",
          panel_status: panelResponse.status,
          panel_content_type: panelResponse.headers.get("content-type") || "",
          html_bytes: html.length,
          js_assets_found: assetUrls.length,
          js_assets_tested: selectedAssets.length,
          api_base_candidates: [...new Set(apiBaseCandidates)].slice(0, 50),
          bundles
        });
      } catch (e) {
        return json(
          {
            ok: false,
            error: e?.message || String(e)
          },
          503
        );
      }
    }

    if (url.pathname === "/api/rcon-server-info") {
      try {
        const result = await prisonerFetch(
          env,
          PATHS.rconServerInfo
        );

        return json(
          {
            ok: result.ok,
            status: result.status,
            endpoint: result.endpoint,
            data_type: Array.isArray(result.data)
              ? "array"
              : typeof result.data,
            data: result.data
          },
          result.ok ? 200 : result.status
        );
      } catch (e) {
        return json(
          { ok: false, error: e.message },
          503
        );
      }
    }

    if (url.pathname === "/api/rcon-status") {
      try {
        const result = await prisonerFetch(
          env,
          PATHS.rconStatus,
          url.search.slice(1)
        );

        return json(
          {
            ok: result.ok,
            status: result.status,
            endpoint: result.endpoint,
            data: result.data
          },
          result.ok ? 200 : result.status
        );
      } catch (e) {
        return json(
          { ok: false, error: e.message },
          503
        );
      }
    }

    if (url.pathname === "/api/server") {
      try {
        const [
          publicResult,
          rconResult,
          rconStatusResult
        ] = await Promise.all([
          prisonerFetch(env, PATHS.server),
          prisonerFetch(env, PATHS.rconServerInfo),
          prisonerFetch(env, PATHS.rconStatus)
        ]);

        if (
          !publicResult.ok &&
          !rconResult.ok &&
          !rconStatusResult.ok
        ) {
          return json(
            {
              ok: false,
              public_api: {
                endpoint: publicResult.endpoint,
                status: publicResult.status,
                data: publicResult.data
              },
              rcon: {
                endpoint: rconResult.endpoint,
                status: rconResult.status,
                data: rconResult.data
              },
              rcon_status: {
                endpoint: rconStatusResult.endpoint,
                status: rconStatusResult.status,
                data: rconStatusResult.data
              }
            },
            502
          );
        }

        const publicServer = publicResult.ok
          ? normalizeServer(publicResult.data)
          : {};

        const rcon =
          rconResult.ok && isObject(rconResult.data)
            ? rconResult.data
            : {};

        const live =
          rconStatusResult.ok &&
          isObject(rconStatusResult.data)
            ? rconStatusResult.data
            : {};

        const players = findNumeric(live, [
          "players",
          "playersOnline",
          "onlinePlayers",
          "playerCount"
        ]);

        const playerList = Array.isArray(live.playerList)
          ? live.playerList
          : [];

        return json({
          ok: true,
          source: "Prisoner Bot",
          endpoint: PATHS.rconStatus,
          online:
            live.connected === true
              ? true
              : publicServer.online ?? true,
          players:
            players ??
            publicServer.players ??
            null,
          maxPlayers:
            publicServer.maxPlayers ??
            null,
          status:
            live.connected === true
              ? "connected"
              : rcon.status ??
                publicServer.status ??
                null,
          playerList,
          rcon_connected:
            live.connected ?? null,
          gameTime: rcon.gameTime ?? null,
          timeSpeed: rcon.timeSpeed ?? null,
          sunrise: rcon.sunrise ?? null,
          sunset: rcon.sunset ?? null,
          temperature: rcon.temperature ?? null,
          temperatureMin: rcon.temperatureMin ?? null,
          temperatureMax: rcon.temperatureMax ?? null,
          waterTemperature:
            rcon.waterTemperature ?? null,
          fogDensity: rcon.fogDensity ?? null,
          rainIntensity:
            rcon.rainIntensity ?? null,
          snowIntensity:
            rcon.snowIntensity ?? null,
          windIntensity:
            rcon.windIntensity ?? null,
          version: rcon.version ?? null,
          players_available:
            players !== undefined ||
            publicServer.players !== null,
          rcon_ok:
            rconStatusResult.ok ||
            rconResult.ok,
          public_api_ok: publicResult.ok
        });
      } catch (e) {
        return json(
          { ok: false, error: e.message },
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
          source: "Prisoner Bot",
          endpoint: result.endpoint,
          count: players.length,
          players
        });
      } catch (e) {
        return json(
          { ok: false, error: e.message },
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

        const leaderboard =
          normalizeLeaderboard(
            result.data,
            kind
          );

        return json({
          ok: true,
          source: "Prisoner Bot",
          type: kind,
          endpoint: result.endpoint,
          count: leaderboard.length,
          leaderboard
        });
      } catch (e) {
        return json(
          { ok: false, error: e.message },
          503
        );
      }
    }

    if (url.pathname === "/api/prisoner-discovery") {
      const results = {};

      for (const [kind, path] of Object.entries(PATHS)) {
        try {
          const result = await prisonerFetch(
            env,
            path
          );

          results[kind] = {
            ok: result.ok,
            endpoint: path,
            status: result.status
          };
        } catch (e) {
          results[kind] = {
            ok: false,
            endpoint: path,
            error: e.message
          };
        }
      }

      return json({
        ok: true,
        base: BASE,
        results
      });
    }

    return env.ASSETS.fetch(request);
  }
};
