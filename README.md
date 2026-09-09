# Shadow Forge v5 · Auto API

Diese Version verwendet **einen einzigen Prisoner-Bot-Public-API-Token** (`PRISONER_API_TOKEN`).

## Cloudflare

Secret:
- `PRISONER_API_TOKEN` = dein bestehender Token

Optional, sobald die echten Routen bestätigt sind:
- `PRISONER_SERVER_PATH`
- `PRISONER_PLAYERS_PATH`
- `PRISONER_LEADERBOARD_PATH`

V5 versucht zunächst automatisch mehrere übliche Read-Only-Routen. Damit können wir die vorhandene API-Verbindung testen, ohne einen zweiten Token anzulegen.

## Test

- `/api/health` → Token vorhanden?
- `/api/server` → Serverstatus
- `/api/players` → Spieler
- `/api/leaderboard?kills=1` → Kills
- `/api/leaderboard?playtime=1` → Playtime
- `/api/prisoner-discovery` → zeigt nur gefundene Endpunkte/HTTP-Status, niemals den Token

Der Token bleibt ausschließlich serverseitig im Cloudflare Worker.
