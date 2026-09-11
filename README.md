# Shadow Forge V3.2 – Multi-Source Live Count

V3.2 keeps GAMEMONITORING as the primary live source but reconciles the displayed online-player count across all healthy sources.

## Live count
- GAMEMONITORING player-list length when available
- GAMEMONITORING server count
- GS4u live monitor count
- Prisoner Bot server count

The displayed count uses the highest currently reported healthy live count. This prevents a stale GAMEMONITORING `numplayers` value (for example 2) from hiding a higher live count from another source.

The API also returns `countSources` for diagnostics.

## Public server
- Shadow Forge
- Connect: `176.57.174.127:28202`
- Public slots: **60**
- Map: **Island Map**
- GAMEMONITORING server ID: `13954416`

`Monitor Ping` is HTTPS response time to GAMEMONITORING, not raw UDP/A2S ping.

## Deploy
```bash
npx wrangler deploy
```
