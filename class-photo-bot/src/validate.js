const config = require('./config');

/** Accepts accents/unicode (the whole reason for the bot); rejects control chars, mentions, markdown. */
function cleanIgn(raw) {
  const ign = (raw || '').normalize('NFC').trim();
  if (!ign) return { ok: false, reason: 'IGN cannot be empty.' };
  if (ign.length > config.IGN_MAX_LEN) return { ok: false, reason: `IGN must be ${config.IGN_MAX_LEN} characters or fewer.` };
  if (/[\p{C}@#:`*_~|<>\\/]/u.test(ign)) return { ok: false, reason: 'IGN contains characters that are not allowed.' };
  return { ok: true, ign };
}

/** Magic-byte sniffing so a renamed file cannot masquerade as a sprite sheet. */
function sniff(buf) {
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

function checkAttachment(att) {
  if (!att) return { ok: false, reason: 'Please attach your sprite file (.zip from maples.im, or a .png).' };
  if (att.size > config.MAX_FILE_BYTES) return { ok: false, reason: 'File is too large (10 MB max).' };
  const name = (att.name || '').toLowerCase();
  if (!/\.(zip|png)$/.test(name)) return { ok: false, reason: 'Only .zip or .png files are accepted.' };
  return { ok: true };
}

/** Parse "2026-10-31" or "2026-10-31 20:00" as America/New_York wall time -> epoch ms. */
function parseDeadline(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec((str || '').trim());
  if (!m) return null;
  const [y, mo, d, h = '23', mi = '59'] = m.slice(1);
  // Find the UTC instant whose New York wall clock equals the requested time.
  let guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(guess)).reduce((a, p) => ((a[p.type] = p.value), a), {});
    const seen = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    guess += Date.UTC(+y, +mo - 1, +d, +h, +mi) - seen;
  }
  return guess;
}

module.exports = { cleanIgn, sniff, checkAttachment, parseDeadline };
