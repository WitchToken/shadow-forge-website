# Shadow Forge V2.3 – Live & Privacy Safe

## Live data architecture
- SCUM A2S Query Bridge (internal)
- GS4u Live Monitor fallback
- Prisoner Bot Public API for leaderboards/player fallback

## Public website
The website only exposes information intended for players: server online state, current players, max slots, map/version when available, live source, and the normal connect address.

**Internal query host, query port, bridge key, Prisoner Bot token and raw API responses are never returned by the public API.**

## Server capacity
Shadow Forge currently uses **60 public player slots**. The public API treats 60 as the authoritative configured capacity, so stale third-party monitors cannot overwrite it.

## Cloudflare Worker secrets
Set these as Worker secrets/environment variables:
- `PRISONER_API_TOKEN`
- `SCUM_QUERY_BRIDGE_URL`
- `SCUM_QUERY_BRIDGE_KEY` (recommended)
- `SCUM_HOST`
- `SCUM_QUERY_PORT`
- `SCUM_GAME_PORT`

Recommended values for the internal configuration:
- `SCUM_HOST` = your SCUM server host
- `SCUM_QUERY_PORT` = your query port
- `SCUM_GAME_PORT` = your game port

Do not put query credentials or bridge keys into `index.html`.

## Bridge environment
The Node bridge reads:
- `SCUM_HOST`
- `SCUM_QUERY_PORT`
- `SCUM_GAME_PORT`
- `SCUM_QUERY_BRIDGE_KEY`
- `ALLOWED_ORIGIN`

The bridge is intentionally locked to the configured SCUM target and is not an open UDP proxy.

## Deployment
1. Replace the files in the GitHub repository with this package.
2. Set the Worker secrets above in Cloudflare.
3. Deploy with `npx wrangler deploy`.
4. Run the query bridge on a host that can send UDP traffic to the SCUM query service.

## Privacy/security notes
The public `/api/health`, `/api/live`, `/api/query`, and `/api/gs4u` responses intentionally omit internal ports, raw query configuration, bridge keys, tokens, Steam IDs and raw upstream payloads.
