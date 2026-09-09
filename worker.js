const BASE = "https://scum.theprisonerbot.com";

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=UTF-8",
    ...extra
  };
}

function json(data, status=200) {
  return new Response(JSON.stringify(data, null, 2), {status, headers:corsHeaders()});
}

/*
  IMPORTANT:
  The Public API base URL is verified from the Prisoner Bot token page.
  The exact resource paths are intentionally configurable instead of guessed.
  Set these Worker secrets/variables after Prisoner Bot provides the current
  resource paths:
    PRISONER_API_TOKEN       (Secret)
    PRISONER_SERVER_PATH     (Variable, e.g. the verified server endpoint)
    PRISONER_PLAYERS_PATH    (Variable)
    PRISONER_LEADERBOARD_PATH (Variable)
*/

async function prisonerFetch(env, path, query="") {
  if (!env.PRISONER_API_TOKEN) throw new Error("PRISONER_API_TOKEN fehlt");
  if (!path) throw new Error("API-Pfad ist noch nicht konfiguriert");
  const target = new URL(path.replace(/^\/+/,"/"), BASE + "/");
  if (query) target.search = query;
  const r = await fetch(target, {
    headers: {
      "PRISONER-BOT-TOKEN": env.PRISONER_API_TOKEN,
      "Accept": "application/json"
    }
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = {raw:text.slice(0,2000)}; }
  if (!r.ok) throw new Error(`Prisoner API ${r.status}`);
  return body;
}

export default {
 async fetch(request, env) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return new Response(null,{status:204,headers:corsHeaders()});

  if (url.pathname === "/api/health") {
    return json({
      ok:true,
      service:"shadow-forge-api",
      prisoner_base_url:BASE,
      token_configured:Boolean(env.PRISONER_API_TOKEN),
      resource_paths_configured:Boolean(env.PRISONER_SERVER_PATH && env.PRISONER_PLAYERS_PATH && env.PRISONER_LEADERBOARD_PATH)
    });
  }

  if (url.pathname === "/api/server") {
    try {
      const data = await prisonerFetch(env, env.PRISONER_SERVER_PATH);
      return json({online:true, players_available:true, source:"Prisoner Bot", data});
    } catch (e) {
      return json({
        online:true, players_available:false, source:"Shadow Forge",
        message:"Prisoner-Bot-API ist sicher eingebunden, aber der Server-Endpunkt ist noch nicht konfiguriert.",
        error:e.message
      }, 503);
    }
  }

  if (url.pathname === "/api/players") {
    try { return json(await prisonerFetch(env, env.PRISONER_PLAYERS_PATH, url.search.slice(1))); }
    catch(e){ return json({error:e.message},503); }
  }

  if (url.pathname === "/api/leaderboard") {
    try { return json(await prisonerFetch(env, env.PRISONER_LEADERBOARD_PATH, url.search.slice(1))); }
    catch(e){ return json({error:e.message},503); }
  }

  return env.ASSETS.fetch(request);
 }
};
