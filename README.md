# SHADOW FORGE — Website V2

A full-width Shadow Forge SCUM server portal using:

- Cloudflare Worker for the public API
- Prisoner Bot Public API for server/player database + leaderboards
- Optional SCUM A2S/Source Query Bridge for live player count, max slots, server name, map, version and ping
- Responsive Shadow Forge UI

## Server connection

- Host: `176.57.174.127`
- Game / Server Port: `28202`
- Query Port: `28215`

## 1. Cloudflare Worker

Upload `worker.js` to the existing `WitchToken/shadow-forge-website` repository.

Keep the existing build command:

```text
npx wrangler deploy
```

The Worker needs this existing secret:

```text
PRISONER_API_TOKEN
```

Add these Worker secrets/variables for the query bridge:

```text
SCUM_QUERY_BRIDGE_URL=https://YOUR-BRIDGE-DOMAIN/query
SCUM_QUERY_BRIDGE_KEY=YOUR_LONG_RANDOM_SECRET
```

`SCUM_QUERY_BRIDGE_URL` can be left unset while the bridge is not running. The rest of the site still works from Prisoner Bot.

## 2. Query Bridge

Cloudflare Workers do not directly send arbitrary UDP queries. The bridge runs on a machine that can send UDP to the SCUM query port.

This bridge implements the SCUM/Source A2S_INFO exchange directly and does not depend on GameDig.

Requirements:

- Node.js 18+
- outbound UDP access to `176.57.174.127:28215`
- an HTTP/HTTPS endpoint reachable by the Cloudflare Worker

Install and run:

```bash
cd query-bridge
npm install
cp .env.example .env
```

Set a strong `BRIDGE_KEY`, then:

```bash
node server.js
```

Health:

```text
GET /health
```

Query:

```text
GET /query?host=176.57.174.127&port=28215
```

The bridge intentionally refuses targets other than the configured Shadow Forge server so it cannot be abused as a generic UDP proxy.

## 3. Recommended deployment

Best case: run the bridge on the same hosting environment as the SCUM server if the host allows Node.js applications and outbound UDP.

If the SCUM host cannot run Node.js, use a small VPS or another always-on machine. Cloudflare Tunnel can be used to expose the bridge over HTTPS without opening an inbound port on the machine.

## 4. Public Worker endpoints

```text
/api/live
/api/query
/api/server
/api/players
/api/leaderboard?type=kills
/api/leaderboard?type=playtime
/api/health
```

The frontend only needs `/api/live` plus the leaderboard endpoints.

## 5. Data-source philosophy

The site deliberately does not treat Prisoner Bot's `/players` endpoint as a live RCON player list. It is used as player/database data.

The optional SCUM Query Bridge is the authoritative source for live:

- online/offline
- current players
- max slots
- server name
- map
- version
- query ping

This keeps the site honest and gives us a second independent source.

## 6. Security

Never put `PRISONER_API_TOKEN` in `index.html`.

Never put the bridge secret in `index.html`.

Only the Cloudflare Worker should know the bridge key.

The bridge is not an open proxy: it accepts only the configured Shadow Forge host/port.
