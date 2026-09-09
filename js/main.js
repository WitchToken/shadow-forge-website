// Shadow Forge frontend bootstrap.
// Live server data will be connected through a Cloudflare Worker/API in the next phase.
document.addEventListener("DOMContentLoaded", () => {
  const players = document.querySelector("#players");
  if (players) players.textContent = "LIVE";
});
