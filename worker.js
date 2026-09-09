export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/server") {
      const response = {
        online: true,
        server: "SHADOW FORGE",
        game: "SCUM",
        mode: "PvE/PvP",
        loot: "3x",
        region: "EU",
        players_available: false,
        players: null,
        maxPlayers: null,
        gs4u_id: "436818",
        gs4u_url: "https://www.gs4u.net/de/s/436818",
        generated_at: new Date().toISOString()
      };

      return new Response(JSON.stringify(response, null, 2), {
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "cache-control": "no-store"
        }
      });
    }

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "shadow-forge-api" });
    }

    return env.ASSETS.fetch(request);
  }
};
