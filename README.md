# Shadow Forge V3 — GAMEMONITORING Live Stack

This version uses GAMEMONITORING as the public HTTPS server-monitor source. No VPS, UDP bridge, VPC service or query bridge is required.

## Live source
- GAMEMONITORING server ID: `13954416`
- Public API: `https://api.gamemonitoring.net/servers/13954416`
- Shadow Forge connection address remains `176.57.174.127:28202`
- Public website capacity is intentionally fixed to **60 slots**.
- Map is intentionally displayed as **Island Map** because GAMEMONITORING currently reports no map value for Shadow Forge.
- The displayed "Monitor Ping" is the HTTPS response time from GAMEMONITORING, not a raw UDP A2S query latency.

## Fallback
GS4u remains a fallback for online/player count if GAMEMONITORING is temporarily unavailable. Its stale slot value is ignored; the website always displays 60 slots.

## Prisoner Bot
The Worker optionally calls the documented Public API endpoints for server/player data and leaderboards:
- `/server`
- `/players`
- `/leaderboard/kills`
- `/leaderboard/playtime`

Set only this Worker secret if you want Prisoner Bot rankings enabled:
- `PRISONER_API_TOKEN`

Also set:
- `DISCORD_URL=https://discord.gg/XDsAjmSFhq`

The Prisoner Bot token stays server-side and is never returned to the browser.

## Cloudflare deployment
Repository root:
- `index.html`
- `worker.js`
- `wrangler.toml`

Build command: none
Deploy command: `npx wrangler deploy`

No query-bridge directory is required in this version.
