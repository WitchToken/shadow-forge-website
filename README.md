# ⚒️ Shadow Forge Website — GitHub Ready

Production-ready Cloudflare Worker + static website for **Shadow Forge SCUM**.

## Live data architecture

- **Prisoner Bot Public API → RCON** is the primary source for live players via `POST /api/public/command/send` with `#ListPlayers`.
- **Prisoner Bot Kill Webhook → Cloudflare KV** stores the latest killfeed.
- **Prisoner Bot Public API** provides leaderboards.
- **GAMEMONITORING** remains a fallback/monitoring source.
- **GS4u** remains a fallback for server availability.
- Public capacity is fixed at **60 slots**.
- Public map label is **Island Map**.

## Files

```text
index.html
worker.js
wrangler.toml
.gitignore
.assetsignore
README.md
```

## 1. Cloudflare KV

This package declares the `KILLFEED_KV` binding without hard-coding a namespace ID. With current Wrangler/Workers Builds, the binding can be automatically provisioned on deploy. If you prefer to create it yourself, create a KV namespace such as `SHADOW_FORGE_KILLFEED` and bind it in Cloudflare under **Worker → Settings → Bindings → Add → KV Namespace**, using variable name `KILLFEED_KV`. Cloudflare documents both binding approaches.

## 2. Cloudflare Secret

Create this Worker secret:

`PRISONER_API_TOKEN`

Use the token generated in the Prisoner Bot panel. **Never commit it to GitHub.**

Optional second secret:

`KILLFEED_WEBHOOK_SECRET`

If set, use the secret as the final path segment of the webhook URL. Example:

`https://YOUR-WORKER.workers.dev/api/webhooks/prisoner/kill/YOUR_SECRET`

The path secret is accepted directly; Prisoner Bot does not need to send a custom header. If you do not set this secret, the webhook endpoint remains available at `/api/webhooks/prisoner/kill`.

## 3. Prisoner Bot webhook

Create a **Kill** webhook in Prisoner Bot and point it to the Worker webhook URL above.

The Worker stores up to 40 recent events for up to 7 days.

## 4. Cloudflare deployment

The existing Cloudflare Workers GitHub deployment can use:

- Root directory: `/`
- Build command: empty / none
- Deploy command: `npx wrangler deploy`
- Production branch: `main`

No VPS, UDP bridge or VPC is required for the live-player path.

## API endpoints

### `GET /api/live`
Complete live server payload.

### `GET /api/rcon-players`
Direct live player list from Prisoner Bot RCON.

### `GET /api/players`
Same live RCON player list, for the website player section.

### `GET /api/killfeed`
Latest stored killfeed.

### `POST /api/webhooks/prisoner/kill[/SECRET]`
Receives Prisoner Bot Kill webhook events.

### `GET /api/leaderboard?type=kills`
Kill leaderboard.

### `GET /api/leaderboard?type=playtime`
Playtime leaderboard.

### `GET /api/health`
Integration health/status.

## Security

- No Prisoner Bot token is shipped to the browser.
- No token belongs in GitHub.
- Use Cloudflare Worker Secrets for credentials.
- If a token was ever pasted into chat, rotate it.

## Shadow Forge

Connect: `176.57.174.127:28202`

Capacity: **60**

Discord: `https://discord.gg/XDsAjmSFhq`
