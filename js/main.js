async function json(url){
  const r=await fetch(url,{cache:"no-store"});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||data.message||`HTTP ${r.status}`);
  return data;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function row(name,value){return `<div class="row"><span>${escapeHtml(name)}</span><b>${escapeHtml(value)}</b></div>`}
function playerLabel(x){return x?.name||x?.player||x?.playerName||x?.username||x?.steamName||x?.displayName||"Player"}
function rankingValue(x,kind){
  if(kind==="kills") return x?.kills??x?.killCount??x?.killsCount??x?.value??x?.score??"—";
  return x?.playtime??x?.playTime??x?.totalPlaytime??x?.hours??x?.minutes??x?.value??"—";
}
function statusValue(x){return x?.status||x?.state||x?.online===true?"online":x?.online===false?"offline":"online"}

async function load(){
  try{
    const s=await json("/api/server");
    document.querySelector("#dot").className=s.online?"online":"offline";
    document.querySelector("#status").textContent=s.online?"SERVER ONLINE":"SERVER OFFLINE";
    document.querySelector("#playersCount").textContent=s.players_available?(s.maxPlayers!=null?`${s.players}/${s.maxPlayers}`:String(s.players)):"—";
    document.querySelector("#serverMessage").textContent=`Prisoner Bot · ${s.endpoint}`;
  }catch(e){
    document.querySelector("#dot").className="offline";
    document.querySelector("#status").textContent="API FEHLER";
    document.querySelector("#serverMessage").textContent=e.message;
  }

  try{
    const p=await json("/api/players");
    const list=Array.isArray(p.players)?p.players:[];
    if(list.length){
      document.querySelector("#playersPanel").innerHTML=list.slice(0,50)
        .map(x=>row(playerLabel(x),statusValue(x))).join("");
    }else{
      const count = Number(document.querySelector("#playersCount").textContent.split("/")[0]);
      document.querySelector("#playersPanel").innerHTML =
        Number.isFinite(count) && count > 0
          ? `<div class="row"><span>Online-Spieler</span><b>${count}</b></div><div class="muted">Die API liefert aktuell die Anzahl, aber keine Spielerliste.</div>`
          : "Keine Spieler online / keine Player-Daten verfügbar.";
    }
  }catch(e){document.querySelector("#playersPanel").innerHTML=`<span class="loading">${escapeHtml(e.message)}</span>`}

  for(const [id,kind] of [["kills","kills"],["playtime","playtime"]]){
    try{
      const d=await json(`/api/leaderboard?type=${kind}`);
      const list=Array.isArray(d.leaderboard)?d.leaderboard:[];
      document.querySelector("#"+id).innerHTML=list.length
        ?list.slice(0,10).map((x,i)=>row(`#${i+1} ${playerLabel(x)}`,String(rankingValue(x,kind)))).join("")
        :"Keine Daten verfügbar.";
    }catch(e){document.querySelector("#"+id).innerHTML=`<span class="loading">${escapeHtml(e.message)}</span>`}
  }
}
load();
setInterval(load,60000);
