# Shadow Forge v4 · Prisoner Bot API

## Cloudflare
Root: `/`
Build: none
Deploy: `npx wrangler deploy`

## Secret
Keep the existing Cloudflare Secret:
`PRISONER_API_TOKEN`

## Variables still required
The Prisoner Bot account page confirms the API base URL:
`https://scum.theprisonerbot.com`

The public feature documentation confirms token auth via `PRISONER-BOT-TOKEN`, player data, leaderboards, economy, packages and server commands.

The exact resource paths are not exposed on the public feature page, so this build deliberately does NOT guess them.

Configure these Worker Variables once the official API paths are confirmed:
- PRISONER_SERVER_PATH
- PRISONER_PLAYERS_PATH
- PRISONER_LEADERBOARD_PATH

The Worker then proxies those read-only requests server-side. The token never reaches the browser.

## Safety
No write/admin endpoint is exposed in this version.
