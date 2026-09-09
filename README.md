# Shadow Forge V6.5 – RCON Live Debug

This build keeps V6.4 and adds a temporary `/api/rcon-server-info` route so the raw RCON ServerInfo response can be inspected safely. It contains no API token.

Test:
`https://shadow-forge.sveamareenbusiness.workers.dev/api/rcon-server-info`

After confirming the payload, remove this debug route before final production deployment.
