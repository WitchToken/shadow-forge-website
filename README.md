# Shadow Forge V2.6 — All Live Connections

## Live data sources

The public website combines the integrations already available for Shadow Forge:

1. **SCUM A2S / Source Query via private HTTP bridge**
   - Live player count
   - Query ping
   - Map
   - SCUM version
   - Live player names when A2S_PLAYER responds
2. **GS4u Live Monitor**
   - Online/offline fallback
   - Live player count fallback
   - The site's reported slot count is intentionally ignored; Shadow Forge is fixed to **60 slots**.
3. **Prisoner Bot Public API**
   - Server fallback
   - Kills leaderboard
   - Playtime leaderboard

## Public website data

Only these gameplay/community values are exposed:

- Online/offline
- Survivors
- 60 server slots
- Query ping
- Version
- Map
- Top Kills
- Playtime
- Discord invite
- Server connect address

No query port, query host, bridge key, Prisoner Bot token, RCON data, Steam IDs, or raw upstream responses are returned by the public API.

## Cloudflare Worker variables

Required/optional:

- `PRISONER_API_TOKEN` — Prisoner Bot Public API token
- `SCUM_QUERY_BRIDGE_URL` — private HTTPS URL of the query bridge
- `SCUM_QUERY_BRIDGE_KEY` — secret shared with the bridge
- `DISCORD_URL` — Shadow Forge Discord invite

The Worker never sends the SCUM query port to the browser.

## Query bridge variables

- `SCUM_HOST` — private SCUM server host
- `SCUM_QUERY_PORT` — private query port
- `BRIDGE_KEY` — required shared secret
- `REQUIRE_KEY=true` — recommended/default
- `PORT` — HTTP listener port
- `QUERY_TIMEOUT_MS` — UDP timeout
- `ALLOWED_ORIGIN` — optional CORS origin

The bridge is intentionally a fixed-target query service. It does not accept arbitrary host/port values, so it cannot be used as an open UDP proxy.

## Cloudflare deployment

Root directory: `/`

Build command: none

Deploy command:

```bash
npx wrangler deploy
```

Production branch: `main`
