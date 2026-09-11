# Shadow Forge Live Website

## Dateien

- `worker.js` — Cloudflare Worker + Public API Proxy
- `index.html` — Shadow Forge Live Dashboard

## Cloudflare

Repository:
`WitchToken/shadow-forge-website`

Worker:
`shadow-forge`

Build:
```text
npx wrangler deploy
```

Der Worker benötigt das bereits verwendete Cloudflare Secret:

```text
PRISONER_API_TOKEN
```

Der Token wird ausschließlich serverseitig verwendet und niemals an den Browser ausgegeben.

## Website Live API

Die Website ruft ausschließlich:

```text
/api/live
```

auf und aktualisiert die Anzeige automatisch alle 30 Sekunden.

Zusätzlich:

```text
/api/server
/api/players
/api/leaderboard?type=kills
/api/leaderboard?type=playtime
/api/health
```

## Wichtig

Die Admin-RCON-Endpunkte wurden absichtlich NICHT als öffentliche Website-API eingebaut. Die bisherige Untersuchung hat gezeigt, dass diese Endpunkte eine separate Admin-Bearer-Authentifizierung verwenden.

Die Website zeigt daher nur Werte an, die über die bestätigte Public API erreichbar sind. Nicht bestätigte Live-Werte werden nicht erfunden.
