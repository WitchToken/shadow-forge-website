# Shadow Forge Website v3

Cloudflare Workers Static Assets + Worker API.

## Cloudflare Build settings

- Root directory: `/`
- Build command: none
- Deploy command: `npx wrangler deploy`
- Non-production deploy: `npx wrangler versions upload`
- Production branch: `main`

## API

- `/api/health`
- `/api/server`

The current `/api/server` intentionally does not invent live player numbers. GS4u JSON/JSONP access requires the relevant GS4u API entitlement, so this version exposes verified Shadow Forge metadata and leaves player counts unavailable until we add a legitimate data source.

## Next

1. Add real Shadow Forge branding assets.
2. Replace placeholder Discord URL.
3. Add event data.
4. Add a database/API layer.
5. Add server telemetry when a supported source is available.
6. Add Prisoner/Bounty systems.
