const BASE = "https://scum.theprisonerbot.com/api";
const PANEL = "https://scumpanel.theprisonerbot.com/";

const TARGETS = [
  "/admin/rcon-dashboard/status",
  "/admin/rcon-dashboard/server-info",
  "/admin/rcon-dashboard/exec-command",
  "/admin/rcon-dashboard/player-stats",
  "/admin/rcon-dashboard/set-player-attributes",
  "/admin/rcon-dashboard/set-player-skill",
  "/admin/rcon-dashboard/announce",
  "/admin/rcon-dashboard/message-player",
  "/admin/rcon-dashboard/kick-player",
  "/admin/rcon-dashboard/ban-player"
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

function sanitize(text) {
  return String(text || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(["'`]?Authorization["'`]?)\s*[:=]\s*([^,;}\n]+)/gi,
      "$1: [REDACTED]"
    )
    .replace(
      /(["'`]?PRISONER-BOT-TOKEN["'`]?)\s*[:=]\s*([^,;}\n]+)/gi,
      "$1: [REDACTED]"
    )
    .replace(
      /(["'`]?token["'`]?)\s*[:=]\s*(["'`])[^"'`]*\2/gi,
      "$1: [REDACTED]"
    )
    .replace(
      /(["'`]?cookie["'`]?)\s*[:=]\s*(["'`])[^"'`]*\2/gi,
      "$1: [REDACTED]"
    )
    .replace(
      /localStorage\.[A-Za-z0-9_$]+/gi,
      "localStorage.[REDACTED]"
    )
    .replace(
      /sessionStorage\.[A-Za-z0-9_$]+/gi,
      "sessionStorage.[REDACTED]"
    );
}

function extractScripts(html) {
  const out = [];

  for (const m of html.matchAll(
    /(?:src|href)=["']([^"']+\.js(?:\?[^"']*)?)["']/gi
  )) {
    try {
      const u = new URL(m[1], PANEL).toString();

      if (!out.includes(u)) {
        out.push(u);
      }
    } catch {}
  }

  return out;
}

function extractImports(text, baseUrl) {
  const out = [];

  const patterns = [
    /import\s*\(\s*["'](\.\/[^"']+\.m?js[^"']*)["']\s*\)/g,
    /(?:from|import)\s*["'](\.\/[^"']+\.m?js[^"']*)["']/g,
    /["'](\.\/[A-Za-z0-9_-]+\.m?js)["']/g
  ];

  for (const re of patterns) {
    let m;

    while ((m = re.exec(text)) !== null) {
      try {
        const u = new URL(m[1], baseUrl).toString();

        if (!out.includes(u)) {
          out.push(u);
        }
      } catch {}
    }
  }

  return out;
}

function scoreAsset(url) {
  const s = url.toLowerCase();

  let score = 0;

  for (const term of [
    "kep-bvjg",
    "cuijuiko",
    "rcon",
    "network",
    "monitor",
    "api",
    "auth",
    "composable",
    "chunk"
  ]) {
    if (s.includes(term)) {
      score += 10;
    }
  }

  return score;
}

function snippetsAround(text, needle, radius = 1800, max = 6) {
  const hits = [];
  let from = 0;

  while (hits.length < max) {
    const idx = text.indexOf(needle, from);

    if (idx < 0) {
      break;
    }

    const start = Math.max(0, idx - radius);
    const end = Math.min(
      text.length,
      idx + needle.length + radius
    );

    hits.push({
      offset: idx,
      snippet: sanitize(
        text.slice(start, end)
      ).replace(/\s+/g, " ")
    });

    from = idx + needle.length;
  }

  return hits;
}

function regexContexts(text, regex, radius = 1000, max = 20) {
  const hits = [];
  let m;

  while (
    hits.length < max &&
    (m = regex.exec(text)) !== null
  ) {
    const start = Math.max(0, m.index - radius);

    const end = Math.min(
      text.length,
      m.index + (m[0]?.length || 0) + radius
    );

    const snippet = sanitize(
      text.slice(start, end)
    ).replace(/\s+/g, " ");

    if (snippet.length) {
      hits.push({
        offset: m.index,
        snippet
      });
    }
  }

  return hits;
}

async function fetchText(
  url,
  accept = "application/javascript,text/javascript,*/*"
) {
  const r = await fetch(url, {
    headers: {
      Accept: accept
    }
  });

  return {
    status: r.status,
    contentType: r.headers.get("content-type") || "",
    text: await r.text()
  };
}

async function discover() {
  const panel = await fetchText(
    PANEL,
    "text/html"
  );

  const mainAssets = extractScripts(panel.text);

  const all = new Set(mainAssets);
  const queue = [...mainAssets];
  const scanned = [];

  /*
   * Follow imports for up to 3 levels.
   * This is intended to find the actual API/auth
   * helper used by the RCON dashboard.
   */

  for (
    let depth = 0;
    depth < 3 &&
    queue.length &&
    all.size < 80;
    depth++
  ) {
    const current = queue.splice(0, queue.length);

    for (const asset of current) {
      try {
        const r = await fetchText(asset);

        scanned.push({
          asset,
          depth,
          bytes: r.text.length
        });

        for (
          const imp of extractImports(r.text, asset)
        ) {
          if (
            !all.has(imp) &&
            all.size < 80
          ) {
            all.add(imp);
            queue.push(imp);
          }
        }
      } catch {}
    }
  }

  const assets = [...all].sort(
    (a, b) => scoreAsset(b) - scoreAsset(a)
  );

  const selected = assets.slice(0, 60);
  const bundles = [];

  for (const asset of selected) {
    try {
      const r = await fetchText(asset);
      const text = r.text;

      const targetHits = {};

      for (const target of TARGETS) {
        const h = snippetsAround(
          text,
          target,
          2200,
          8
        );

        if (h.length) {
          targetHits[target] = h;
        }
      }

      const authContexts = regexContexts(
        text,
        /Authorization|PRISONER-BOT-TOKEN|credentials\s*:|headers\s*:|apiUrl|baseURL|Bearer|ofetch|\$fetch|fetch\s*\(/gi,
        900,
        80
      );

      const imports = extractImports(
        text,
        asset
      );

      if (
        Object.keys(targetHits).length ||
        authContexts.length
      ) {
        bundles.push({
          asset,
          score: scoreAsset(asset),
          status: r.status,
          content_type: r.contentType,
          bytes: text.length,
          imports: imports.slice(0, 80),
          target_contexts: targetHits,
          auth_fetch_contexts: authContexts
        });
      }
    } catch (e) {
      bundles.push({
        asset,
        ok: false,
        error: e?.message || String(e)
      });
    }
  }

  return {
    ok: true,
    source:
      "Prisoner Bot targeted RCON auth/API discovery V6",

    api_base: BASE,

    panel_status: panel.status,

    panel_content_type:
      panel.contentType,

    main_assets_found:
      mainAssets.length,

    assets_discovered:
      all.size,

    assets_scanned_for_imports:
      scanned.length,

    assets_tested:
      selected.length,

    targets: TARGETS,

    note:
      "Only sanitized code context is returned. Credentials, tokens, cookies and storage values are redacted.",

    bundles
  };
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

        token_configured:
          Boolean(env.PRISONER_API_TOKEN),

        discovery_v6:
          "/api/public-discovery-v6"
      });
    }

    if (
      url.pathname ===
      "/api/public-discovery-v6"
    ) {
      try {
        return json(
          await discover()
        );
      } catch (e) {
        return json(
          {
            ok: false,
            error:
              e?.message ||
              String(e)
          },
          503
        );
      }
    }

    return new Response(
      "Shadow Forge API",
      {
        status: 200,
        headers: corsHeaders({
          "Content-Type":
            "text/plain; charset=UTF-8"
        })
      }
    );
  }
};
