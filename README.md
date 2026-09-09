# Shadow Forge v6 · Live API

Cloudflare Worker + static site for Shadow Forge SCUM.

## Prisoner Bot API
Base URL: `https://scum.theprisonerbot.com`

The Worker uses one Cloudflare secret only:
- `PRISONER_API_TOKEN`

Confirmed read-only endpoints:
- `/server`
- `/players`
- `/leaderboard/kills`
- `/leaderboard/playtime`

Public Worker routes:
- `/api/health`
- `/api/server`
- `/api/players`
- `/api/leaderboard?type=kills`
- `/api/leaderboard?type=playtime`
- `/api/prisoner-discovery`

The v6 parser recursively handles common Prisoner Bot JSON wrappers (`data`, `results`, `items`, `players`, `leaderboard`, etc.) so the frontend does not depend on one exact nesting level.
