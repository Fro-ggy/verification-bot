const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const fs = require('fs');
const config = require('./config');
const Store = require('./store');
const { cleanIgn, sniff, checkAttachment, parseDeadline } = require('./validate');

const serverChoices = config.SERVERS.map((s) => ({ name: s, value: s }));
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:F> (<t:${Math.floor(ms / 1000)}:R>)`;
const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;

const definition = new SlashCommandBuilder()
  .setName('classphoto')
  .setDescription('Kain class photo submissions')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('submit').setDescription('Submit (or replace) your sprite for the class photo')
    .addStringOption((o) => o.setName('ign').setDescription('Your in-game name, accents allowed').setRequired(true))
    .addStringOption((o) => o.setName('server').setDescription('Your MapleStory server').setRequired(true).addChoices(...serverChoices))
    .addAttachmentOption((o) => o.setName('sprite').setDescription('Sprite sheet .zip from maples.im, or a .png').setRequired(true)))
  .addSubcommand((s) => s.setName('status').setDescription('Show the event deadline and your submissions'))
  .addSubcommand((s) => s.setName('withdraw').setDescription('Remove one of your submissions')
    .addStringOption((o) => o.setName('ign').setDescription('IGN to remove').setRequired(true))
    .addStringOption((o) => o.setName('server').setDescription('Server of that character').setRequired(true).addChoices(...serverChoices)))
  .addSubcommand((s) => s.setName('open').setDescription('[Admin] Start a class photo event (replaces any previous event)')
    .addStringOption((o) => o.setName('deadline').setDescription('YYYY-MM-DD or YYYY-MM-DD HH:mm, US Eastern').setRequired(true))
    .addStringOption((o) => o.setName('title').setDescription('Event title, e.g. "2026 Kain Class Photo"')))
  .addSubcommand((s) => s.setName('close').setDescription('[Admin] Close submissions now'))
  .addSubcommand((s) => s.setName('extend').setDescription('[Admin] Reopen / move the deadline')
    .addStringOption((o) => o.setName('deadline').setDescription('YYYY-MM-DD or YYYY-MM-DD HH:mm, US Eastern').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('[Admin] List all submissions'))
  .addSubcommand((s) => s.setName('remove').setDescription('[Admin] Remove someone\'s submission')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('ign').setDescription('IGN').setRequired(true))
    .addStringOption((o) => o.setName('server').setDescription('Server').setRequired(true).addChoices(...serverChoices)))
  .addSubcommand((s) => s.setName('export').setDescription('[Admin] Download all sprites + manifest as a zip'));

const ADMIN_SUBS = new Set(['open', 'close', 'extend', 'list', 'remove', 'export']);

function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild)
    || (config.ADMIN_ROLE_ID && member.roles.cache.has(config.ADMIN_ROLE_ID));
}

const reply = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function isOpen(ev) { return ev && ev.open && Date.now() < ev.deadline; }

async function handle(interaction, store) {
  const sub = interaction.options.getSubcommand();
  const member = interaction.member;

  if (ADMIN_SUBS.has(sub) && !isAdmin(member)) return reply(interaction, 'This command is restricted to server managers.');

  switch (sub) {
    case 'submit': return submit(interaction, store);
    case 'status': return status(interaction, store);
    case 'withdraw': {
      const ev = store.event;
      if (!isOpen(ev)) return reply(interaction, 'Submissions are closed, so withdrawals must go through a manager.');
      const ign = interaction.options.getString('ign').normalize('NFC');
      const server = interaction.options.getString('server');
      const gone = store.remove(interaction.user.id, ign, server);
      if (!gone) return reply(interaction, 'No matching submission found. Check the IGN spelling and server.');
      fs.rmSync(store.spritePath(gone.file), { force: true });
      return reply(interaction, `Removed **${gone.ign}** (${gone.server}).`);
    }
    case 'open': {
      const deadline = parseDeadline(interaction.options.getString('deadline'));
      if (!deadline || deadline < Date.now()) return reply(interaction, 'Invalid or past deadline. Use `YYYY-MM-DD` or `YYYY-MM-DD HH:mm` (US Eastern).');
      const title = interaction.options.getString('title') || `${new Date().getFullYear()} Kain Class Photo`;
      store.openEvent({ title, deadline, open: true, channelId: config.ANNOUNCE_CHANNEL_ID || interaction.channelId, remindersSent: [] });
      return interaction.reply({ content: `**${title}** is open. Submit with \`/classphoto submit\` (Verified members only).\nDeadline: ${ts(deadline)}` });
    }
    case 'close': {
      if (!store.event) return reply(interaction, 'No event exists.');
      store.closeEvent();
      return interaction.reply({ content: `Submissions for **${store.event.title}** are now closed (${store.state.submissions.length} received).` });
    }
    case 'extend': {
      if (!store.event) return reply(interaction, 'No event exists.');
      const deadline = parseDeadline(interaction.options.getString('deadline'));
      if (!deadline || deadline < Date.now()) return reply(interaction, 'Invalid or past deadline.');
      store.reopenEvent(deadline);
      return interaction.reply({ content: `Deadline for **${store.event.title}** moved to ${ts(deadline)}. Submissions are open.` });
    }
    case 'list': {
      const subs = store.state.submissions;
      if (!subs.length) return reply(interaction, 'No submissions yet.');
      const lines = subs.map((s, n) => `${n + 1}. **${s.ign}** (${s.server}) <@${s.userId}> \`${s.kind}\``);
      return reply(interaction, lines.join('\n').slice(0, 1900) + (lines.join('\n').length > 1900 ? '\n…(truncated, use /classphoto export)' : ''));
    }
    case 'remove': {
      const user = interaction.options.getUser('user');
      const gone = store.remove(user.id, interaction.options.getString('ign'), interaction.options.getString('server'));
      if (!gone) return reply(interaction, 'No matching submission.');
      fs.rmSync(store.spritePath(gone.file), { force: true });
      return reply(interaction, `Removed **${gone.ign}** (${gone.server}) from ${user}.`);
    }
    case 'export': return exportAll(interaction, store);
  }
}

async function submit(interaction, store) {
  const ev = store.event;
  if (!ev) return reply(interaction, 'There is no class photo event right now.');
  if (!isOpen(ev)) return reply(interaction, 'Submissions are closed.');
  if (!interaction.member.roles.cache.has(config.VERIFIED_ROLE_ID)) {
    return reply(interaction, 'Only Verified Kain players can submit. Please complete verification first.');
  }
  const ignCheck = cleanIgn(interaction.options.getString('ign'));
  if (!ignCheck.ok) return reply(interaction, ignCheck.reason);
  const { ign } = ignCheck;
  const server = interaction.options.getString('server');
  const att = interaction.options.getAttachment('sprite');
  const attCheck = checkAttachment(att);
  if (!attCheck.ok) return reply(interaction, attCheck.reason);

  const existing = store.find(interaction.user.id, ign, server);
  if (!existing && store.forUser(interaction.user.id).length >= config.MAX_PER_USER) {
    return reply(interaction, `You already have ${config.MAX_PER_USER} submissions. Withdraw one first.`);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let buf;
  try { buf = await download(att.url); } catch (e) { return interaction.editReply(`Could not download your file: ${e.message}. Please try again.`); }
  const kind = sniff(buf);
  if (!kind) return interaction.editReply('That file is not a real .zip or .png. Re-export it from maples.im and try again.');
  if (kind === 'zip') {
    try { new AdmZip(buf).getEntries(); } catch { return interaction.editReply('That .zip appears to be corrupted. Re-export and try again.'); }
  }

  // Stored under an opaque ID: the accented IGN lives in the manifest, never in a filename.
  const file = `${crypto.randomUUID()}.${kind}`;
  fs.writeFileSync(store.spritePath(file), buf);
  const old = store.upsert({
    key: Store.key(interaction.user.id, ign, server),
    userId: interaction.user.id, username: interaction.user.username,
    ign, server, kind, file, originalName: att.name, submittedAt: Date.now(),
  });
  if (old) fs.rmSync(store.spritePath(old.file), { force: true });
  return interaction.editReply(`${old ? 'Updated' : 'Received'}: **${ign}** (${server}). You can resubmit any time before the deadline.`);
}

async function status(interaction, store) {
  const ev = store.event;
  if (!ev) return reply(interaction, 'There is no class photo event right now.');
  const mine = store.forUser(interaction.user.id);
  const embed = new EmbedBuilder().setTitle(ev.title)
    .setDescription(`${isOpen(ev) ? 'Open' : 'Closed'}. Deadline: ${ts(ev.deadline)}`)
    .addFields({ name: 'Your submissions', value: mine.length ? mine.map((s) => `${s.ign} (${s.server})`).join('\n') : 'None yet' })
    .setFooter({ text: `${store.state.submissions.length} total submissions` });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function exportAll(interaction, store) {
  const subs = store.state.submissions;
  if (!subs.length) return reply(interaction, 'Nothing to export yet.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const zip = new AdmZip();
  const rows = ['ign,server,discord_user,discord_id,file,submitted_at_utc'];
  subs.forEach((s, n) => {
    // ASCII-safe filename (accents stripped) so it opens everywhere; true IGN is in the manifest.
    const safe = s.ign.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '_') || 'sprite';
    const name = `sprites/${String(n + 1).padStart(3, '0')}_${safe}_${s.server.replace(/\s+/g, '')}.${s.kind}`;
    zip.addFile(name, fs.readFileSync(store.spritePath(s.file)));
    rows.push([s.ign, s.server, s.username, s.userId, name, new Date(s.submittedAt).toISOString()].map(csvCell).join(','));
  });
  zip.addFile('manifest.csv', Buffer.from('﻿' + rows.join('\n'), 'utf8')); // BOM keeps accents intact in Excel
  const out = zip.toBuffer();
  if (out.length > config.MAX_FILE_BYTES) {
    return interaction.editReply(`Export is ${(out.length / 1048576).toFixed(1)} MB, above Discord's upload limit. Pull it from the DATA_DIR volume instead.`);
  }
  return interaction.editReply({ content: `Exported ${subs.length} submissions.`, files: [new AttachmentBuilder(out, { name: 'class-photo-export.zip' })] });
}

module.exports = { definition, handle };
