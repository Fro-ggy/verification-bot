# Kain Discord MCP

A small MCP server that lets Claude use YOUR Discord bot to post announcements.

Tools: whoami, list channels, get channel, read messages, post message, edit message, add reaction, pin message, create text channel (optionally locked to one role).
Not included on purpose: delete, ban, kick, role changes. Mentions never ping unless Claude explicitly allows them.

## Hosted (Railway)
Set these variables on the service (never commit them):

| Variable | Purpose |
|---|---|
| `DISCORD_BOT_TOKEN` | Your bot's token |
| `MCP_SECRET` | Random string, 32+ characters. Clients must send `Authorization: Bearer <secret>` |
| `DISCORD_ALLOWED_CHANNELS` | Comma-separated channel IDs the bot may write to (required) |

Endpoint: `POST https://<your-domain>/mcp` (Streamable HTTP, stateless). `GET /health` returns `ok`.
The server refuses to start if any of the three variables is missing.

## Local (stdio)
    npm install
    node index.js --stdio
with `DISCORD_BOT_TOKEN` (or `DISCORD_ENV_FILE` pointing at a file with a `DISCORD_TOKEN=` line) and optionally `DISCORD_ALLOWED_CHANNELS`.

## Bot permissions
View Channel, Send Messages, Read Message History, Add Reactions, Manage Messages (pins); Manage Channels only for channel creation.

## Security
Anyone with the secret can post as the bot in the allowed channels. Rotate `MCP_SECRET` in Railway if it leaks, and reset the bot token in the Discord Developer Portal if it is ever exposed.
Note: read tools, `discord_list_channels` and channel creation are not limited by the allow-list.
