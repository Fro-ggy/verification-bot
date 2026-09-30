/**
 * Tiny JSON-file store with atomic writes. Deliberately dependency-free
 * (no native modules) so it deploys cleanly on Railway.
 *
 * data/state.json   -> { event, submissions }
 * data/sprites/<id> -> stored sprite files (Discord CDN links expire, so we keep our own copy)
 */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'state.json');
    this.spriteDir = path.join(dir, 'sprites');
    fs.mkdirSync(this.spriteDir, { recursive: true });
    this.state = { event: null, submissions: [] };
    if (fs.existsSync(this.file)) this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get event() { return this.state.event; }

  openEvent(ev) {
    this.state = { event: ev, submissions: [] };
    this.save();
  }

  closeEvent() {
    if (this.state.event) { this.state.event.open = false; this.save(); }
  }

  reopenEvent(deadline) {
    this.state.event.open = true;
    this.state.event.deadline = deadline;
    this.state.event.remindersSent = [];
    this.save();
  }

  markReminder(h) {
    this.state.event.remindersSent.push(h);
    this.save();
  }

  static key(userId, ign, server) {
    return `${userId}|${ign.normalize('NFC').toLowerCase()}|${server.toLowerCase()}`;
  }

  forUser(userId) { return this.state.submissions.filter((s) => s.userId === userId); }

  find(userId, ign, server) {
    const k = Store.key(userId, ign, server);
    return this.state.submissions.find((s) => s.key === k);
  }

  upsert(sub) {
    const i = this.state.submissions.findIndex((s) => s.key === sub.key);
    let old = null;
    if (i >= 0) { old = this.state.submissions[i]; this.state.submissions[i] = sub; }
    else this.state.submissions.push(sub);
    this.save();
    return old;
  }

  remove(userId, ign, server) {
    const k = Store.key(userId, ign, server);
    const i = this.state.submissions.findIndex((s) => s.key === k);
    if (i < 0) return null;
    const [gone] = this.state.submissions.splice(i, 1);
    this.save();
    return gone;
  }

  spritePath(file) { return path.join(this.spriteDir, file); }
}

module.exports = Store;
