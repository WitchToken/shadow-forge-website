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


    // ============================================================
    // PUBLIC API DISCOVERY V4
    // V3 found the Admin Panel's real JS bundle and the API base:
    // https://scum.theprisonerbot.com/api
    //
    // V4 extracts API-like string literals and nearby code fragments
    // from the bundle. This is intentionally SAFE:
    // - no Authorization headers
    // - no tokens/cookies/localStorage values
    // - no full JS bundle
    // - only endpoint-like strings and short context snippets
    // ============================================================
    if (url.pathname === "/api/public-discovery-v4") {
      try {
        const panelUrl = "https://scumpanel.theprisonerbot.com/";
        const panelResponse = await fetch(panelUrl, {
          method: "GET",
          headers: { "Accept": "text/html" }
        });

        const html = await panelResponse.text();

        const scriptMatches = [
          ...html.matchAll(/(?:src|href)="([^"]+\.js(?:\?[^"]*)?)"/gi)
        ];

        const assetUrls = [];

        for (const match of scriptMatches) {
          let asset = match[1];

          if (!asset.startsWith("http")) {
            asset = new URL(asset, panelUrl).toString();
          }

          if (!assetUrls.includes(asset)) {
            assetUrls.push(asset);
          }
        }

        const selectedAssets = assetUrls.slice(0, 10);
        const bundles = [];

        // API endpoint-looking strings.
        const endpointRegexes = [
          /["'`]([^"'`]{0,180}\/api\/[^"'`]{0,180})["'`]/gi,
          /["'`]([^"'`]{0,180}(?:rcon-dashboard|rcon|player-list|playerlist|players|monitoring|server-info|server-status|online-players|leaderboard)[^"'`]{0,180})["'`]/gi,
          /["'`]([^"'`]{0,180}(?:\$fetch|useFetch|fetch|axios)[^"'`]{0,180})["'`]/gi
        ];

        // Generic string literals containing API-relevant words.
        const relevantWordRegex =
          /["'`]([^"'`]{1,220}(?:\/api|rcon-dashboard|server-info|server-status|online-players|player-list|playerlist|players|monitoring|leaderboard)[^"'`]{0,220})["'`]/gi;

        for (const assetUrl of selectedAssets) {
          try {
            const jsResponse = await fetch(assetUrl, {
              method: "GET",
              headers: {
                "Accept": "application/javascript,text/javascript,*/*"
              }
            });

            const jsText = await jsResponse.text();
            const endpoints = new Set();
            const relevantStrings = new Set();

            for (const regex of endpointRegexes) {
              let match;

              while ((match = regex.exec(jsText)) !== null) {
                const value = match[1]
                  .replace(/\\(["'`\\])/g, "$1")
                  .trim();

                if (
                  value.length >= 2 &&
                  value.length <= 300 &&
                  !/token|authorization|cookie|password|secret|localstorage|sessionstorage/i.test(value)
                ) {
                  endpoints.add(value);
                }
              }
            }

            let match;
            while ((match = relevantWordRegex.exec(jsText)) !== null) {
              const value = match[1]
                .replace(/\\(["'`\\])/g, "$1")
                .trim();

              if (
                value.length >= 2 &&
                value.length <= 300 &&
                !/token|authorization|cookie|password|secret|localstorage|sessionstorage/i.test(value)
              ) {
                relevantStrings.add(value);
              }
            }

            // Look for API calls where the path is assembled from variables.
            // Return only a short sanitized context around interesting terms.
            const contextHits = [];
            const contextRegex =
              /(?:\$fetch|useFetch|fetch|axios|apiUrl|rcon-dashboard|server-info|server-status|player-list|online-players|monitoring)/gi;

            while ((match = contextRegex.exec(jsText)) !== null && contextHits.length < 150) {
              const start = Math.max(0, match.index - 180);
              const end = Math.min(jsText.length, match.index + 320);

              let snippet = jsText.slice(start, end)
                .replace(/\s+/g, " ")
                .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
                .replace(/(?:token|authorization|cookie|password|secret)\s*[:=]\s*["'`][^"'`]{0,300}["'`]/gi, "$1=[REDACTED]");

              if (!/token|authorization|cookie|password|secret/i.test(snippet)) {
                contextHits.push(snippet);
              }
            }

            bundles.push({
              asset: assetUrl,
              status: jsResponse.status,
              content_type: jsResponse.headers.get("content-type") || "",
              bytes: jsText.length,
              endpoint_candidates: [...endpoints].slice(0, 500),
              relevant_strings: [...relevantStrings].slice(0, 500),
              context_hits: contextHits
            });
          } catch (e) {
            bundles.push({
              asset: assetUrl,
              ok: false,
              error: e?.message || String(e)
            });
          }
        }

        return json({
          ok: true,
          source: "Prisoner Bot Admin Panel bundle API discovery V4",
          panel_status: panelResponse.status,
          panel_content_type:
            panelResponse.headers.get("content-type") || "",
          html_bytes: html.length,
          api_base: BASE,
          js_assets_found: assetUrls.length,
          js_assets_tested: selectedAssets.length,
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


    // ============================================================
    // PUBLIC API DISCOVERY V5
    // V4 proved that the main Nuxt bundle contains lazy-loaded
    // components for:
    //   /rcon-dashboard
    //   /network-monitoring
    // The actual API calls are very likely inside those lazy chunks.
    //
    // V5 therefore:
    // 1. Downloads the main Nuxt bundle.
    // 2. Extracts lazy-loaded .js chunk filenames.
    // 3. Downloads those chunks.
    // 4. Searches them for real API calls / endpoint strings.
    //
    // SAFE OUTPUT:
    // - no Authorization headers
    // - no tokens
    // - no cookies
    // - no localStorage/sessionStorage values
    // - no full JS bundles
    // ============================================================
    if (url.pathname === "/api/public-discovery-v5") {
      try {
        const panelUrl = "https://scumpanel.theprisonerbot.com/";
        const panelResponse = await fetch(panelUrl, {
          method: "GET",
          headers: { "Accept": "text/html" }
        });

        const html = await panelResponse.text();

        const scriptMatches = [
          ...html.matchAll(/(?:src|href)="([^"]+\.js(?:\?[^"]*)?)"/gi)
        ];

        const mainAssets = [];

        for (const match of scriptMatches) {
          const asset = new URL(match[1], panelUrl).toString();
          if (!mainAssets.includes(asset)) mainAssets.push(asset);
        }

        const allAssets = new Set(mainAssets);

        // Vite/Nuxt lazy imports use patterns such as:
        // import("./Kep-BVJg.js")
        // import("./BbFNcS-d.js")
        // and __vite__mapDeps([...]).
        //
        // We extract every relative .js import visible in the
        // currently loaded bundle. This is more reliable than
        // guessing API endpoint names.
        const discoveredImports = new Set();

        for (const assetUrl of mainAssets.slice(0, 10)) {
          try {
            const response = await fetch(assetUrl, {
              method: "GET",
              headers: {
                "Accept": "application/javascript,text/javascript,*/*"
              }
            });

            const text = await response.text();

            const importPatterns = [
              /import\(["'](\.\/[^"']+\.js)["']\)/g,
              /import\(["'](\.\/[^"']+\.m?js[^"']*)["']\)/g,
              /["'](\.\/[A-Za-z0-9_-]+\.js)["']/g
            ];

            for (const regex of importPatterns) {
              let match;
              while ((match = regex.exec(text)) !== null) {
                const absolute = new URL(
                  match[1],
                  assetUrl
                ).toString();

                discoveredImports.add(absolute);
                allAssets.add(absolute);
              }
            }
          } catch (_) {
            // Individual bundle failures are reported later.
          }
        }

        // Prioritize chunks whose names are associated with the
        // two relevant areas discovered in V4.
        const priorityTerms = [
          "Kep-BVJg",
          "BbFNcS-d",
          "rcon",
          "network",
          "monitor"
        ];

        const assetArray = [...allAssets];

        assetArray.sort((a, b) => {
          const aScore = priorityTerms.reduce(
            (n, term) => n + (a.toLowerCase().includes(term.toLowerCase()) ? 1 : 0),
            0
          );
          const bScore = priorityTerms.reduce(
            (n, term) => n + (b.toLowerCase().includes(term.toLowerCase()) ? 1 : 0),
            0
          );
          return bScore - aScore;
        });

        const selectedAssets = assetArray.slice(0, 40);
        const bundles = [];

        function addMatches(set, text, regex, limit = 500) {
          let match;

          while ((match = regex.exec(text)) !== null && set.size < limit) {
            const value = match[1]
              .replace(/\\(["'`\\])/g, "$1")
              .replace(/[\\"'`;,)\]}]+$/g, "")
              .trim();

            if (
              value.length >= 2 &&
              value.length <= 350 &&
              !/token|authorization|cookie|password|secret|localstorage|sessionstorage/i.test(value)
            ) {
              set.add(value);
            }
          }
        }

        for (const assetUrl of selectedAssets) {
          try {
            const response = await fetch(assetUrl, {
              method: "GET",
              headers: {
                "Accept": "application/javascript,text/javascript,*/*"
              }
            });

            const text = await response.text();

            const endpointCandidates = new Set();
            const apiCallCandidates = new Set();
            const contextHits = [];

            // Direct string paths.
            addMatches(
              endpointCandidates,
              text,
              /["'`]([^"'`]{0,260}\/(?:api|admin|rcon|players|server|monitoring)[^"'`]{0,260})["'`]/gi
            );

            // API-relevant strings even when the /api prefix is
            // supplied separately as baseURL.
            addMatches(
              endpointCandidates,
              text,
              /["'`]([^"'`]{1,260}(?:rcon-dashboard|server-info|server-status|online-players|player-list|playerlist|player_tracking|network_monitoring|monitoring|players|server)[^"'`]{0,260})["'`]/gi
            );

            // Look for actual fetch calls and capture a short,
            // sanitized expression around them.
            const callRegex =
              /(?:\$fetch|useFetch|fetch|axios\.(?:get|post|put|delete))\s*\(/gi;

            let match;
            while (
              (match = callRegex.exec(text)) !== null &&
              contextHits.length < 250
            ) {
              const start = Math.max(0, match.index - 120);
              const end = Math.min(text.length, match.index + 650);

              let snippet = text
                .slice(start, end)
                .replace(/\s+/g, " ")
                .replace(
                  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
                  "Bearer [REDACTED]"
                )
                .replace(
                  /(?:token|authorization|cookie|password|secret)\s*[:=]\s*["'`][^"'`]{0,300}["'`]/gi,
                  "$1=[REDACTED]"
                );

              // Don't return a snippet if it still appears to
              // contain credential material.
              if (
                !/token|authorization|cookie|password|secret/i.test(snippet)
              ) {
                contextHits.push(snippet);
              }

              const nearby = text.slice(
                match.index,
                Math.min(text.length, match.index + 500)
              );

              addMatches(
                apiCallCandidates,
                nearby,
                /["'`]([^"'`]{1,300})["'`]/g,
                250
              );
            }

            // Specifically expose baseURL-like configuration values,
            // but never credential values.
            const baseUrlCandidates = new Set();

            addMatches(
              baseUrlCandidates,
              text,
              /(?:baseURL|apiUrl|apiURL|baseUrl)\s*[:=]\s*["'`]([^"'`]{1,300})["'`]/gi,
              100
            );

            bundles.push({
              asset: assetUrl,
              priority_match: priorityTerms.filter(
                term => assetUrl.toLowerCase().includes(term.toLowerCase())
              ),
              status: response.status,
              content_type:
                response.headers.get("content-type") || "",
              bytes: text.length,
              endpoint_candidates: [...endpointCandidates].slice(0, 500),
              api_call_candidates: [...apiCallCandidates].slice(0, 500),
              base_url_candidates: [...baseUrlCandidates].slice(0, 100),
              fetch_call_contexts: contextHits.slice(0, 250)
            });
          } catch (e) {
            bundles.push({
              asset: assetUrl,
              ok: false,
              error: e?.message || String(e)
            });
          }
        }

        return json({
          ok: true,
          source: "Prisoner Bot lazy bundle API discovery V5",
          panel_status: panelResponse.status,
          api_base: BASE,
          main_assets_found: mainAssets.length,
          lazy_assets_discovered: discoveredImports.size,
          assets_tested: selectedAssets.length,
          note:
            "V5 scans lazy-loaded Nuxt/Vite bundles for the real API calls used by RCON Dashboard and Network Monitoring. Credentials are never returned.",
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
