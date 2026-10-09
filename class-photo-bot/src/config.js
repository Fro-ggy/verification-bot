require('dotenv').config();

const list = (v, d) => (v ? v : d).split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  TOKEN: process.env.DISCORD_TOKEN,
  GUILD_ID: process.env.GUILD_ID,
  VERIFIED_ROLE_ID: process.env.VERIFIED_ROLE_ID || '1174862374411456582',
  ANNOUNCE_CHANNEL_ID: process.env.ANNOUNCE_CHANNEL_ID || null,
  SUBMISSION_LOG_CHANNEL_ID: process.env.SUBMISSION_LOG_CHANNEL_ID || null,
  ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID || null,
  SERVERS: list(
    process.env.SERVERS,
    'Bera,Scania,Luna,Aurora,Elysium,Kronos,Hyperion,Solis,Reboot NA,Reboot EU,Other'
  ).slice(0, 25),
  DATA_DIR: process.env.DATA_DIR || './data',
  MAX_PER_USER: parseInt(process.env.MAX_PER_USER || '3', 10),
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  IGN_MAX_LEN: 24,
  REMINDER_HOURS: [168, 24, 1], // 7 days, 1 day, 1 hour before deadline
  TICK_MS: 5 * 60 * 1000,
};
