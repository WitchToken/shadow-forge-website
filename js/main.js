async function json(url){
 const r=await fetch(url,{cache:"no-store"});
 const data=await r.json().catch(()=>({}));
 if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`);
 return data;
}
function row(name,value){return `<div class="row"><span>${escapeHtml(name)}</span><b>${escapeHtml(String(value))}</b></div>`}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

async function load(){
 try{
  const s=await json("/api/server");
  document.querySelector("#dot").className=s.online?"online":"offline";
  document.querySelector("#status").textContent=s.online?"SERVER ONLINE":"SERVER OFFLINE";
  document.querySelector("#playersCount").textContent=s.players_available?`${s.players}/${s.maxPlayers}`:"—";
  document.querySelector("#serverMessage").textContent=s.message||"Shadow Forge API";
 }catch(e){
  document.querySelector("#dot").className="offline";
  document.querySelector("#status").textContent="API FEHLER";
  document.querySelector("#serverMessage").textContent=e.message;
 }
 try{
  const p=await json("/api/players");
  const list=p.players||[];
  document.querySelector("#playersPanel").innerHTML=list.length?list.map(x=>row(x.name||x.player||"Player",x.status||"online")).join(""):"Keine Player-Daten verfügbar.";
 }catch(e){document.querySelector("#playersPanel").innerHTML=`<span class="loading">${escapeHtml(e.message)}</span>`}
 for(const [id,path] of [["kills","/api/leaderboard?kills=1"],["playtime","/api/leaderboard?playtime=1"]]){
  try{
   const d=await json(path); const list=d.data||d.players||d.leaderboard||[];
   document.querySelector("#"+id).innerHTML=list.length?list.slice(0,10).map((x,i)=>row(`#${i+1} ${x.name||x.player||"Player"}`,x.kills??x.playtime??x.value??"—")).join(""):"Keine Daten verfügbar.";
  }catch(e){document.querySelector("#"+id).innerHTML=`<span class="loading">${escapeHtml(e.message)}</span>`}
 }
}
load(); setInterval(load,60000);
