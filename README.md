# Shadow Forge V2.8 — Production Live Stack

This package separates the public Cloudflare site from the private SCUM A2S query bridge.

## Public live values
- Survivors
- 60 server slots
- Query ping
- SCUM version
- Map
- Top Kills
- Playtime
- Discord

## Private values
The query host, query ports, bridge key and Prisoner Bot token are never returned to the browser.

## 1. Cloudflare Worker secrets
Set these in the `shadow-forge` Worker:

- `PRISONER_API_TOKEN` = your Prisoner Bot Public API token
- `SCUM_QUERY_BRIDGE_URL` = HTTPS URL ending in `/query`
- `SCUM_QUERY_BRIDGE_KEY` = the same random secret as `BRIDGE_KEY`
- `DISCORD_URL` = `https://discord.gg/XDsAjmSFhq`

## 2. Run the bridge on a Linux VPS
Host-Unlimited offers Linux Debian/Ubuntu vServers with SSH access. The bridge needs a host that can send outbound UDP to the SCUM query service and expose one HTTPS endpoint.

```bash
sudo apt update
sudo apt install -y nodejs npm nginx
mkdir -p ~/shadow-forge-query
cd ~/shadow-forge-query
```

Copy `query-bridge/server.js`, `package.json` and `.env` here.

Example `.env`:

```env
SCUM_HOST=176.57.174.127
SCUM_QUERY_PORT=28215
SCUM_QUERY_FALLBACK_PORTS=28204
PORT=8787
BRIDGE_KEY=REPLACE_WITH_A_LONG_RANDOM_SECRET
REQUIRE_KEY=true
ALLOWED_ORIGIN=https://shadow-forge.sveamareenbusiness.workers.dev
QUERY_TIMEOUT_MS=3000
```

Start:

```bash
node server.js
```

The bridge tries the configured query port first and then the optional fallback list. It never accepts an arbitrary host/port from the request, so it is not an open UDP proxy.

## 3. HTTPS reverse proxy
Put Nginx/Caddy/Cloudflare Tunnel in front of port 8787 and use the resulting HTTPS `/query` URL as `SCUM_QUERY_BRIDGE_URL`.

## 4. Test
Local bridge health:

```bash
curl http://127.0.0.1:8787/health
```

Authenticated query:

```bash
curl -H "X-Shadow-Forge-Key: YOUR_KEY" http://127.0.0.1:8787/query
```

A successful response contains server name, map, version, player count, max players, query ping and player names. The public Worker strips all internal connection details before returning data to the site.

## Prisoner Bot
The Worker calls the documented Public API endpoints:
- `/server`
- `/players`
- `/leaderboard/kills`
- `/leaderboard/playtime`

The token is server-side only.
