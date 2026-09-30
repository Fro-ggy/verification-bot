const { Client, GatewayIntentBits, Events } = require('discord.js');
const config = require('./src/config');
const Store = require('./src/store');
const commands = require('./src/commands');

if (!config.TOKEN || !config.GUILD_ID) {
  console.error('DISCORD_TOKEN and GUILD_ID are required.');
  process.exit(1);
}

const store = new Store(config.DATA_DIR);
// Only Guilds + GuildMembers: slash commands need no message content intent.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

async function tick() {
  const ev = store.event;
  if (!ev || !ev.open) return;
  const channel = await client.channels.fetch(ev.channelId).catch(() => null);
  const left = ev.deadline - Date.now();
  if (left <= 0) {
    store.closeEvent();
    await channel?.send(`Submissions for **${ev.title}** are now closed. ${store.state.submissions.length} sprites received.`);
    return;
  }
  for (const h of config.REMINDER_HOURS) {
    if (left <= h * 3600e3 && !ev.remindersSent.includes(h)) {
      store.markReminder(h);
      // Only send the most urgent due reminder; mark the looser ones as sent so a restart doesn't spam.
      config.REMINDER_HOURS.filter((x) => x > h).forEach((x) => !ev.remindersSent.includes(x) && store.markReminder(x));
      await channel?.send(`Reminder: **${ev.title}** closes <t:${Math.floor(ev.deadline / 1000)}:R>. Use \`/classphoto submit\` (Verified members). ${store.state.submissions.length} submitted so far.`);
      break;
    }
  }
}

client.once(Events.ClientReady, async (c) => {
  await c.application.commands.set([commands.definition.toJSON()], config.GUILD_ID);
  console.log(`Class photo bot ready as ${c.user.tag}`);
  setInterval(() => tick().catch((e) => console.error('tick', e)), config.TICK_MS);
  tick().catch((e) => console.error('tick', e));
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand() || i.commandName !== 'classphoto') return;
  try { await commands.handle(i, store); }
  catch (e) {
    console.error(e);
    const msg = 'Something went wrong. Please try again or contact a manager.';
    if (i.deferred || i.replied) await i.editReply(msg).catch(() => {});
    else await i.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

client.login(config.TOKEN);
