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
  Shadow Forge uses ONE Prisoner Bot Public API token for all read requests.
  If exact resource paths are not configured yet, the worker tries a small
  set of common read-only route candidates automatically. This lets us test
  the existing API connection before we know the provider's exact route names.

  Secret:
    PRISONER_API_TOKEN

  Optional variables (recommended once confirmed):
    PRISONER_SERVER_PATH
    PRISONER_PLAYERS_PATH
    PRISONER_LEADERBOARD_PATH
*/

const CANDIDATES = {
  server: ["/server","/server-status","/status","/servers","/api/server","/api/status","/api/servers","/v1/server","/v1/servers"],
  players: ["/players","/api/players","/v1/players"],
  kills: ["/leaderboard/kills","/leaderboards/kills","/rankings/kills","/leaderboard/top-killers","/leaderboards/top-killers","/rankings/top-killers","/leaderboard","/leaderboards","/rankings","/api/leaderboard","/api/leaderboards","/api/rankings","/v1/leaderboard","/v1/leaderboards","/v1/rankings"],
  playtime: ["/leaderboard/playtime","/leaderboards/playtime","/rankings/playtime","/leaderboard","/leaderboards","/rankings","/api/leaderboard","/api/leaderboards","/api/rankings","/v1/leaderboard","/v1/leaderboards","/v1/rankings"]
};

async function rawPrisonerFetch(env, path, query="") {
  if (!env.PRISONER_API_TOKEN) throw new Error("PRISONER_API_TOKEN fehlt");
  const target = new URL(path.replace(/^\/+/,"/"), BASE + "/");
  if (query) target.search = query;
  const r = await fetch(target, {
    headers: {"PRISONER-BOT-TOKEN": env.PRISONER_API_TOKEN, "Accept":"application/json"}
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = {raw:text.slice(0,2000)}; }
  return { ok:r.ok, status:r.status, path, body };
}

function looksLikeObject(x){ return x && typeof x === "object" && !Array.isArray(x); }
function arrayFrom(body){
  if (Array.isArray(body)) return body;
  for (const k of ["players","data","items","results","leaderboard","rankings","rows"]){
    if (Array.isArray(body?.[k])) return body[k];
  }
  return [];
}
function normalizeServer(body){
  const x = body?.data && looksLikeObject(body.data) ? body.data : body;
  const players = Number(x?.players ?? x?.onlinePlayers ?? x?.playerCount ?? x?.online ?? NaN);
  const maxPlayers = Number(x?.maxPlayers ?? x?.max_players ?? x?.slots ?? x?.max ?? NaN);
  const status = String(x?.status ?? x?.serverStatus ?? "").toLowerCase();
  const online = typeof x?.online === "boolean" ? x.online : (status ? !["offline","down","stopped"].includes(status) : true);
  return {online, players: Number.isFinite(players)?players:null, maxPlayers:Number.isFinite(maxPlayers)?maxPlayers:null};
}

async function findEndpoint(env, kind, configuredPath, query=""){
  const paths = configuredPath ? [configuredPath] : CANDIDATES[kind];
  const tried=[];
  for (const path of paths){
    try{
      const r=await rawPrisonerFetch(env,path,query);
      tried.push({path:r.path,status:r.status});
      if(r.ok && (looksLikeObject(r.body) || Array.isArray(r.body))) return {...r, tried};
    }catch(e){ tried.push({path,status:"error"}); }
  }
  const err=new Error(`Kein passender Prisoner-Bot-Endpunkt gefunden (${kind}).`);
  err.tried=tried;
  throw err;
}

function resultWithMeta(found){ return {source:"Prisoner Bot", endpoint:found.path, data:found.body}; }

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
      const found = await findEndpoint(env,"server",env.PRISONER_SERVER_PATH);
      const normalized = normalizeServer(found.body);
      return json({online:normalized.online, players_available:normalized.players !== null, players:normalized.players, maxPlayers:normalized.maxPlayers, endpoint:found.path, source:"Prisoner Bot", data:found.body});
    } catch (e) {
      return json({online:false, players_available:false, source:"Shadow Forge", message:e.message, tried:e.tried||[]},503);
    }
  }

  if (url.pathname === "/api/players") {
    try {
      const found=await findEndpoint(env,"players",env.PRISONER_PLAYERS_PATH,url.search.slice(1));
      return json(resultWithMeta(found));
    } catch(e){ return json({error:e.message,tried:e.tried||[]},503); }
  }

  if (url.pathname === "/api/leaderboard") {
    const kind=url.searchParams.has("playtime")?"playtime":"kills";
    try {
      const found=await findEndpoint(env,kind,env.PRISONER_LEADERBOARD_PATH);
      return json(resultWithMeta(found));
    } catch(e){ return json({error:e.message,tried:e.tried||[]},503); }
  }

  if (url.pathname === "/api/prisoner-discovery") {
    if (!env.PRISONER_API_TOKEN) return json({ok:false,error:"PRISONER_API_TOKEN fehlt"},503);
    const out={};
    for (const kind of ["server","players","kills","playtime"]) {
      try {
        const found=await findEndpoint(env,kind,kind==="server"?env.PRISONER_SERVER_PATH:kind==="players"?env.PRISONER_PLAYERS_PATH:env.PRISONER_LEADERBOARD_PATH);
        out[kind]={ok:true,endpoint:found.path,status:found.status};
      } catch(e) { out[kind]={ok:false,tried:e.tried||[]}; }
    }
    return json({ok:true,base:BASE,results:out});
  }

  return env.ASSETS.fetch(request);
 }
};
