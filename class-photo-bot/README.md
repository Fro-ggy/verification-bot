# Kain Class Photo Bot

Standalone bot (own `package.json`, own Discord token, own Railway service). It shares nothing with the verification bot in the repo root; do not merge them.

## What it does
- `/classphoto submit ign server sprite`: Verified members submit a maples.im `.zip` or `.png`. IGNs may contain accents; files are stored under opaque IDs and the real IGN is kept in the manifest.
- Validates file type by magic bytes, size (10 MB), zip integrity, per-user cap (`MAX_PER_USER`), and the Verified role. Resubmitting the same IGN + server replaces the old file.
- `/classphoto status`, `/classphoto withdraw`.
- Admin (Manage Server or `ADMIN_ROLE_ID`): `open`, `close`, `extend`, `list`, `remove`, `export`.
- Deadlines are entered in US Eastern. Reminders post 7 days, 1 day and 1 hour before; the event closes itself at the deadline.
- `export` returns a zip of numbered sprites plus `manifest.csv` (UTF-8 with BOM so accents survive Excel).

## Deploy (Railway)
1. New service from this repo, root directory `class-photo-bot`.
2. Variables: see `.env.example` (`DISCORD_TOKEN`, `GUILD_ID` required).
3. Add a Volume mounted at `/data` and set `DATA_DIR=/data`. Without a volume, submissions are lost on every redeploy.
4. Bot invite scopes: `bot`, `applications.commands`. Needs Send Messages in the announce channel. No privileged intents required except Server Members.

## Not included
Automatic character lookup from an IGN, and composing the final picture.
