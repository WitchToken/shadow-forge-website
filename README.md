# Shadow Forge V6.6 – RCON Auth Test

This version tests the Prisoner Bot RCON dashboard endpoint with Bearer authentication because the browser request uses `Authorization: Bearer ...`, while the public API uses `PRISONER-BOT-TOKEN`.

Test route after deployment:
`/api/rcon-server-info`

No token is returned by the debug route.
