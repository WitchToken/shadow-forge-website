# Shadow Forge V3.4 — Prisoner Bot RCON Command Live Players

V3.4 adds a read-only live-player diagnostic using the Prisoner Bot Public API command bridge.

## What changed
- Prisoner Bot RCON command is now the **primary live-player source**.
- The Worker sends the SCUM command `#ListPlayers` through the Prisoner Bot Public API.
- If the command response contains structured player data, it is parsed directly.
- If the response is plain text, the Worker conservatively extracts rows containing a 17-digit Steam64 ID.
- Existing Prisoner Bot `/server` and `/players` endpoints remain available.
- GAMEMONITORING and GS4u remain fallbacks.
- The public server capacity stays fixed at **60 slots**.
- The public map stays **Island Map**.

## Required Cloudflare Secret
`PRISONER_API_TOKEN`

Do not put the token in the repository or browser code.

## Optional Worker variables
- `PRISONER_COMMAND_PATH` — defaults to `/command`
- `PRISONER_COMMAND_FIELD` — defaults to `command`

The command sent is intentionally read-only: `#ListPlayers`.

## Diagnostic endpoint
After deploy, open:
`/api/prisoner-command-test`

It returns the command endpoint path, HTTP status, parsed players and the raw Prisoner Bot response. No token is returned.

## Why #ListPlayers
SCUM's `#ListPlayers` command reports connected players. Prisoner Bot's current RCON/API release notes confirm that its command endpoint works with RCON and requires at least one player online. Prisoner Bot RCON v6.17.5 also fixed empty/incomplete player lists after the recent SCUM update.
