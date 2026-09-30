const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { cleanIgn, sniff, parseDeadline, checkAttachment } = require('../src/validate');
const Store = require('../src/store');

test('IGN accepts accents, rejects mentions/markdown', () => {
  assert.strictEqual(cleanIgn('Étzy').ok, true);
  assert.strictEqual(cleanIgn('Kaïn').ign, 'Kaïn');
  assert.strictEqual(cleanIgn('@everyone').ok, false);
  assert.strictEqual(cleanIgn('a*b').ok, false);
  assert.strictEqual(cleanIgn('').ok, false);
  assert.strictEqual(cleanIgn('x'.repeat(25)).ok, false);
});
test('NFC/NFD accent forms normalise to the same IGN', () => {
  assert.strictEqual(cleanIgn('é').ign, cleanIgn('é').ign);
});
test('sniff detects real zip/png only', () => {
  assert.strictEqual(sniff(Buffer.from([0x50,0x4b,0x03,0x04,0,0])), 'zip');
  assert.strictEqual(sniff(Buffer.from('not a zip at all')), null);
});
test('attachment extension/size checks', () => {
  assert.strictEqual(checkAttachment({ name: 'a.exe', size: 5 }).ok, false);
  assert.strictEqual(checkAttachment({ name: 'a.ZIP', size: 5 }).ok, true);
  assert.strictEqual(checkAttachment({ name: 'a.zip', size: 11e6 }).ok, false);
  assert.strictEqual(checkAttachment(null).ok, false);
});
test('deadline parsed as US Eastern (EDT and EST)', () => {
  assert.strictEqual(new Date(parseDeadline('2026-10-31 20:00')).toISOString(), '2026-11-01T00:00:00.000Z'); // EDT, UTC-4
  assert.strictEqual(new Date(parseDeadline('2026-12-15 20:00')).toISOString(), '2026-12-16T01:00:00.000Z'); // EST, UTC-5
  assert.strictEqual(parseDeadline('garbage'), null);
});
test('store: upsert replaces same key, persists, per-user count', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
  const s = new Store(dir);
  s.openEvent({ title: 't', deadline: Date.now() + 1e6, open: true, remindersSent: [] });
  const mk = (ign, file) => ({ key: Store.key('u1', ign, 'Bera'), userId: 'u1', ign, server: 'Bera', file });
  assert.strictEqual(s.upsert(mk('Étzy', 'a')), null);
  assert.strictEqual(s.upsert(mk('étzy', 'b')).file, 'a'); // case-insensitive replace
  assert.strictEqual(s.forUser('u1').length, 1);
  assert.strictEqual(new Store(dir).forUser('u1').length, 1); // reload from disk
  assert.ok(s.remove('u1', 'ÉTZY', 'Bera'));
});
