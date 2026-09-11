# Shadow Forge Website V2.1

Live Shadow Forge dashboard using three data sources:

1. **SCUM A2S Query Bridge** — preferred source for direct server data and player names.
2. **GS4u Live Monitor** — live fallback for online status, player count, max slots, server name/map/version when the direct UDP query is unavailable.
3. **Prisoner Bot Public API** — database/leaderboards and fallback server/player data.

## Server
- Host: `176.57.174.127`
- Game port: `28202`
- Query port: `28215`
- GS4u server ID: `436818`

## Cloudflare Worker variables
Set these under Worker Variables/Secrets:

- `PRISONER_API_TOKEN` — secret
- `SCUM_QUERY_BRIDGE_URL` — optional HTTPS URL to the Node query bridge
- `SCUM_QUERY_BRIDGE_KEY` — optional secret shared with the bridge

The website never receives the Prisoner Bot token.

## Query bridge
Run `query-bridge/server.js` on a machine that can send UDP traffic to the SCUM server. The bridge is locked to the Shadow Forge target and is not an open UDP proxy.

## Live fallback
The Worker fetches the public GS4u monitoring page for server ID `436818`. GS4u currently exposes Shadow Forge as online with a live player count and max-slot value on its server page. The page is refreshed by GS4u; the Worker caches it only briefly.

This means the dashboard can show real live player/slot data even while the direct UDP bridge is offline. Player names still require the direct SCUM A2S player query or Prisoner Bot data.
