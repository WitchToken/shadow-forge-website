# Shadow Forge V6.7 – RCON Live Status

Uses the confirmed Prisoner Bot RCON dashboard route:
`/api/admin/rcon-dashboard/status`

For RCON dashboard requests the Worker sends `Authorization: Bearer <PRISONER_API_TOKEN>`. The same Cloudflare secret name is retained; no token is returned by the API.

Test after deployment:
`/api/rcon-status`

Expected live payload includes `connected`, `players`, `playerList`, and `timestamp`.
