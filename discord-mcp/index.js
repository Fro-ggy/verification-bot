#!/usr/bin/env node
/**
 * Minimal Discord MCP server for the Kain Discord.
 * Uses YOUR bot token; the token is read from the environment and never sent anywhere except discord.com.
 *
 * Token sources (first found wins):
 *   1. DISCORD_BOT_TOKEN environment variable (hosted use, e.g. Railway)
 *   2. A file named by DISCORD_ENV_FILE containing a line like DISCORD_TOKEN=xxxx
 *
 * Hosted mode (default): also needs MCP_SECRET (32+ chars); clients send 'Authorization: Bearer <secret>' to POST /mcp.
 * Local mode: run with --stdio.
 *
 * Optional safety rails:
 *   DISCORD_ALLOWED_CHANNELS  comma-separated channel IDs the tools may write to (required in hosted mode)
 *
 * Deliberately NOT included: deleting messages/channels, banning, role changes.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

const API = 'https://discord.com/api/v10';

function loadToken() {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN.trim();
  const file = process.env.DISCORD_ENV_FILE;
  if (file && fs.existsSync(file)) {
    const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => /^\s*DISCORD_TOKEN\s*=/.test(l));
    if (line) return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const TOKEN = loadToken();
const ALLOWED = (process.env.DISCORD_ALLOWED_CHANNELS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ANY_CHANNEL = ALLOWED.includes('*'); // explicit opt-out: DISCORD_ALLOWED_CHANNELS=*

async function discord(method, path, body) {
  if (!TOKEN) throw new Error('No bot token found. Set DISCORD_BOT_TOKEN or DISCORD_ENV_FILE.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'kain-discord-mcp (local, 1.0)' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const wait = Number((await res.json().catch(() => ({}))).retry_after || 1);
      await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000));
      continue;
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Discord ${res.status}: ${data?.message || 'error'} (code ${data?.code ?? '?'})`);
    return data;
  }
  throw new Error('Discord rate limit: gave up after retries.');
}

function guard(channelId) {
  if (ALLOWED.length && !ANY_CHANNEL && !ALLOWED.includes(channelId)) {
    throw new Error(`Channel ${channelId} is not in DISCORD_ALLOWED_CHANNELS.`);
  }
}

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: String(e.message || e) }] });
const wrap = (fn) => async (args) => { try { return text(await fn(args)); } catch (e) { return fail(e); } };

// Pings are OFF unless explicitly requested, so a draft containing "@everyone" cannot notify by accident.
const mentions = z.object({
  everyone: z.boolean().optional().describe('Allow @everyone/@here to ping'),
  roleIds: z.array(z.string()).optional().describe('Role IDs allowed to ping'),
  userIds: z.array(z.string()).optional().describe('User IDs allowed to ping'),
}).optional().describe('Which mentions may actually notify. Default: none.');

function allowedMentions(m) {
  const parse = [];
  if (m?.everyone) parse.push('everyone');
  return { parse, roles: m?.roleIds || [], users: m?.userIds || [] };
}

function createServer() {
const server = new McpServer({ name: 'kain-discord', version: '1.0.0' });

server.tool('discord_whoami', 'Check the bot token works and show which bot and servers it is in.', {}, wrap(async () => {
  const me = await discord('GET', '/users/@me');
  const guilds = await discord('GET', '/users/@me/guilds');
  return { bot: { id: me.id, username: me.username }, guilds: guilds.map((g) => ({ id: g.id, name: g.name })) };
}));

server.tool('discord_list_channels', 'List channels in a server the bot is in.', { guildId: z.string() }, wrap(async ({ guildId }) => {
  const ch = await discord('GET', `/guilds/${guildId}/channels`);
  return ch.map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parent_id }));
}));

server.tool('discord_get_channel', 'Check the bot can see a channel and read its basic details.', { channelId: z.string() }, wrap(async ({ channelId }) => {
  const c = await discord('GET', `/channels/${channelId}`);
  return { id: c.id, name: c.name, type: c.type, guildId: c.guild_id, topic: c.topic };
}));

server.tool('discord_read_messages', 'Read recent messages from a channel (needs Read Message History).', {
  channelId: z.string(), limit: z.number().int().min(1).max(50).optional(),
}, wrap(async ({ channelId, limit }) => {
  const msgs = await discord('GET', `/channels/${channelId}/messages?limit=${limit || 20}`);
  return msgs.map((m) => ({ id: m.id, author: m.author?.username, content: m.content, timestamp: m.timestamp, pinned: m.pinned }));
}));

server.tool('discord_post_message', 'Post a message to a channel. Max 2000 characters. Mentions do not ping unless allowMentions says so.', {
  channelId: z.string(), content: z.string().min(1).max(2000), allowMentions: mentions,
}, wrap(async ({ channelId, content, allowMentions }) => {
  guard(channelId);
  const m = await discord('POST', `/channels/${channelId}/messages`, { content, allowed_mentions: allowedMentions(allowMentions) });
  return { posted: true, messageId: m.id, channelId };
}));

server.tool('discord_edit_message', 'Edit a message the bot previously posted.', {
  channelId: z.string(), messageId: z.string(), content: z.string().min(1).max(2000), allowMentions: mentions,
}, wrap(async ({ channelId, messageId, content, allowMentions }) => {
  guard(channelId);
  await discord('PATCH', `/channels/${channelId}/messages/${messageId}`, { content, allowed_mentions: allowedMentions(allowMentions) });
  return { edited: true, messageId };
}));

server.tool('discord_add_reaction', 'Add an emoji reaction to a message (needs Add Reactions). Use a unicode emoji or name:id for custom.', {
  channelId: z.string(), messageId: z.string(), emoji: z.string(),
}, wrap(async ({ channelId, messageId, emoji }) => {
  guard(channelId);
  await discord('PUT', `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`);
  return { reacted: true };
}));

server.tool('discord_pin_message', 'Pin a message in a channel (needs Manage Messages).', {
  channelId: z.string(), messageId: z.string(),
}, wrap(async ({ channelId, messageId }) => {
  guard(channelId);
  await discord('PUT', `/channels/${channelId}/pins/${messageId}`);
  return { pinned: true };
}));

server.tool('discord_create_text_channel', 'Create a text channel (needs Manage Channels). Optionally restrict it to one role.', {
  guildId: z.string(), name: z.string().min(1).max(100), topic: z.string().max(1024).optional(),
  parentCategoryId: z.string().optional(),
  onlyRoleId: z.string().optional().describe('If set, hide from @everyone and allow only this role (plus the bot) to view and post'),
  slowmodeSeconds: z.number().int().min(0).max(21600).optional(),
}, wrap(async ({ guildId, name, topic, parentCategoryId, onlyRoleId, slowmodeSeconds }) => {
  const body = { name, type: 0, topic, parent_id: parentCategoryId, rate_limit_per_user: slowmodeSeconds };
  if (onlyRoleId) {
    const me = await discord('GET', '/users/@me');
    const VIEW_SEND_HISTORY_REACT = String(0x400n | 0x800n | 0x10000n | 0x40n); // view, send, read history, add reactions
    body.permission_overwrites = [
      { id: guildId, type: 0, allow: '0', deny: String(0x400n) },             // @everyone role id == guild id
      { id: onlyRoleId, type: 0, allow: VIEW_SEND_HISTORY_REACT, deny: '0' },
      { id: me.id, type: 1, allow: VIEW_SEND_HISTORY_REACT, deny: '0' },
    ];
  }
  const c = await discord('POST', `/guilds/${guildId}/channels`, body);
  return { created: true, id: c.id, name: c.name };
}));

return server;
}


// ---- Transports -----------------------------------------------------------
if (process.argv.includes('--stdio')) {
  await createServer().connect(new StdioServerTransport());
} else {
  // Hosted mode: Streamable HTTP, stateless, protected by a shared secret.
  const SECRET = process.env.MCP_SECRET || '';
  if (SECRET.length < 32) {
    console.error('Refusing to start: set MCP_SECRET to a random string of at least 32 characters.');
    process.exit(1);
  }
  if (!TOKEN) {
    console.error('Refusing to start: DISCORD_BOT_TOKEN is not set.');
    process.exit(1);
  }
  if (!ALLOWED.length) {
    console.error('Refusing to start: set DISCORD_ALLOWED_CHANNELS to comma-separated channel IDs (recommended), or * to allow every channel the bot can see.');
    process.exit(1);
  }
  const secretBuf = Buffer.from(SECRET);
  const authorized = (req) => {
    const h = req.headers['authorization'] || '';
    const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
    return given.length === secretBuf.length && crypto.timingSafeEqual(given, secretBuf);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1_000_000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined); } catch (e) { reject(e); } });
    req.on('error', reject);
  });

  http.createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0];
    if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (url !== '/mcp') { res.writeHead(404); return res.end(); }
    if (!authorized(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }); return res.end('Unauthorized'); }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
    try {
      const body = await readBody(req);
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error('request error:', e.message);
      if (!res.headersSent) { res.writeHead(400); res.end('Bad request'); }
    }
  }).listen(Number(process.env.PORT || 3000), () => console.log('kain-discord MCP listening (authenticated)'));
}
