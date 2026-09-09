const statusDot=document.querySelector("#status-dot");
const statusText=document.querySelector("#status-text");
const players=document.querySelector("#players");
const note=document.querySelector("#status-note");
const refresh=document.querySelector("#refresh");

async function loadStatus(){
  statusText.textContent="SYSTEM CHECK";
  statusDot.className="dot";
  note.textContent="Prüfe Shadow-Forge-Core …";
  try{
    const res=await fetch("/api/server",{cache:"no-store"});
    if(!res.ok) throw new Error("API "+res.status);
    const data=await res.json();
    statusDot.className="dot "+(data.online?"online":"offline");
    statusText.textContent=data.online?"SERVER ONLINE":"SERVER OFFLINE";
    players.textContent=(data.players_available===false)?"—":`${data.players}/${data.maxPlayers}`;
    note.textContent=data.players_available===false
      ? "Spielerzahl aktuell nicht verfügbar. GS4u PLUS wird dafür nicht vorausgesetzt."
      : "Datenquelle: Shadow Forge API";
  }catch(e){
    statusDot.className="dot offline";
    statusText.textContent="API NICHT ERREICHBAR";
    players.textContent="—";
    note.textContent="Die Website läuft, aber die Server-API antwortet gerade nicht.";
  }
}
refresh?.addEventListener("click",loadStatus);
loadStatus();
