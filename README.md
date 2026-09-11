# Shadow Forge — GitHub Ready V5.2

Cloudflare Worker + static site for Shadow Forge.

## Live integrations

- Prisoner Bot Public API via `PRISONER-BOT-TOKEN`
- Prisoner Bot RCON live players via `POST /api/public/command/send` with `#ListPlayers`
- Prisoner Bot Kill webhook -> Cloudflare KV
- GAMEMONITORING fallback
- GS4u fallback
- Fixed public capacity: 60 slots
- Map label: Island Map

## Required Cloudflare configuration

### 1. Worker Secret
Create a Worker Secret named:

`PRISONER_API_TOKEN`

Set its value to the current Prisoner Bot API token. Never put the token in GitHub or frontend code.

### 2. KV Namespace
Create a KV namespace, e.g.:

`SHADOW_FORGE_KILLFEED`

Copy its Namespace ID into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KILLFEED_KV"
id = "YOUR_NAMESPACE_ID"
```

Commit the changed `wrangler.toml` to `main`.

### 3. Killfeed webhook secret
Create another Worker Secret:

`KILLFEED_WEBHOOK_SECRET`

Use a long random value.

### 4. Prisoner Bot webhook
Create a Prisoner Bot webhook for the `Kill` event.

Target URL:

`https://YOUR_WORKER_DOMAIN/api/webhooks/prisoner/kill/YOUR_KILLFEED_WEBHOOK_SECRET`

Do not paste the secret into GitHub.

## API endpoints

- `/api/health`
- `/api/live`
- `/api/rcon-players`
- `/api/players`
- `/api/killfeed`
- `/api/leaderboard?type=kills`
- `/api/leaderboard?type=playtime`
- `/api/query`

## Expected health

Before secrets/KV are configured, health will correctly show:

- `prisonerBot: false`
- `prisonerRconLivePlayers: false`
- `killfeedWebhook: false`

After configuration they should become true.

## Testing

1. Open `/api/health`.
2. Open `/api/rcon-players` while at least one player is online.
3. Open `/api/killfeed`.
4. Trigger a test kill and reload `/api/killfeed`.
5. Open the main site.

## Security

Never commit Prisoner Bot tokens or webhook secrets. If a token was exposed, rotate it in Prisoner Bot before using the new value in Cloudflare.
