// upshot-sync: read-state sync's devices and storage (docs/architecture/sync.md). The site's Worker forwards
// /api/auth/* and /api/sync here over a service binding; account.js answers them, keeping each reader's state in a Durable
// Object below. It's a Worker of its own because Cloudflare makes no preview URLs for a Worker that defines a Durable
// Object, and the site's Worker needs them for PRs.
import { DurableObject } from 'cloudflare:workers';
import { account } from './account.js';

const DAY = 864e5;
const KEEP = 120 * DAY;  // stories leave the site after 90 days (build.py KEEP_DAYS); a mark untouched this long is for one that's gone
const MAX_MARKS = 2000;  // the site holds about 450 stories at once; this bounds what one reader can store
const MAX_LATER = 500;  // stories saved for later: a story leaves with the site's, so a reader never needs more
const IDLE = 400 * DAY;  // as long as a session cookie lasts unused

// One reader: their devices and their marks. A Durable Object handles one call at a time, so
// each merge sees the last one's result; no change is lost to a race, as one could be with KV. Each method that acts for a
// device takes its session's hash and checks it in the same call, so a request costs one Durable Object request, not two.
//
// It also tells the reader's open pages when something changes, over WebSockets it holds with Cloudflare's hibernation API:
// while they're quiet the object sleeps and isn't billed, opening one is a request, and messages it sends are free. Each
// socket is tagged with its device's session hash: a device isn't told of its own changes. A device that stops syncing,
// for whatever reason, is told so and its sockets close.
export class Reader extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.#schema();
  }
  #schema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, label TEXT NOT NULL, seen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS marks (url TEXT PRIMARY KEY, read INTEGER NOT NULL, at INTEGER NOT NULL, opened INTEGER NOT NULL, seq INTEGER NOT NULL, touched INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS later (url TEXT PRIMARY KEY, saved INTEGER NOT NULL, at INTEGER NOT NULL, seq INTEGER NOT NULL, touched INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v);
      CREATE INDEX IF NOT EXISTS marks_seq ON marks (seq);
      CREATE INDEX IF NOT EXISTS marks_touched ON marks (touched);
      CREATE INDEX IF NOT EXISTS marks_at ON marks (at);
      CREATE INDEX IF NOT EXISTS later_seq ON later (seq);
      CREATE INDEX IF NOT EXISTS later_touched ON later (touched);
      CREATE INDEX IF NOT EXISTS later_at ON later (at);`);
  }
  // Each sync reads only the rows it needs: the indexes spare it a scan of every mark (billed per row read), and the mark
  // count is kept here rather than counted. Set once for a reader stored before it was kept.
  #rows(table) {
    return this.#get(table === 'marks' ? 'n' : 'nl') ?? this.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
  }
  #dropRows(table, where, ...args) { return this.sql.exec(`DELETE FROM ${table} WHERE ${where} RETURNING url`, ...args).toArray().length; }
  // Rows untouched for as long as they're kept go, then the oldest past the cap; the new count is kept in meta.
  #prune(table, n, max, now) {
    n -= this.#dropRows(table, 'touched <= ?', now - KEEP);
    if (n > max) n -= this.#dropRows(table, `url IN (SELECT url FROM ${table} ORDER BY at LIMIT ?)`, n - max);
    this.#set(table === 'marks' ? 'n' : 'nl', n);
  }
  // The alarm: when the reader's last device has gone unused as long as a cookie lasts (then the reader goes), or its
  // oldest mark has gone untouched as long as marks are kept (then those go), whichever comes first. So a reader nobody
  // syncs any more doesn't hold its marks for 400 days.
  #arm() {
    const seen = this.sql.exec('SELECT MAX(seen) AS t FROM sessions').one().t;
    if (seen == null) return;
    const oldest = this.sql.exec('SELECT MIN(t) AS t FROM (SELECT MIN(touched) AS t FROM marks UNION ALL SELECT MIN(touched) FROM later)').one().t;
    this.ctx.storage.setAlarm(Math.min(seen + IDLE, oldest == null ? Infinity : oldest + KEEP));
  }
  #get(k) { return this.sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v ?? null; }
  #set(k, v) { this.sql.exec('INSERT INTO meta VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', k, v); }

  #tell(what, except) {
    for (const ws of this.ctx.getWebSockets()) if (this.ctx.getTags(ws)[0] !== except) try { ws.send(JSON.stringify({ t: what })); } catch {}
  }
  // Tells a device's pages (or every page) that they've stopped syncing, then closes their sockets. The message comes first
  // because a page can be left waiting on the close itself (seen when the sync's storage was deleted straight after).
  #drop(hash) {
    for (const ws of hash ? this.ctx.getWebSockets(hash) : this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify({ t: 'ended' })); } catch {}
      try { ws.close(4001); } catch {}
    }
  }
  // A page's live connection (site/app.js, connectLive), for a valid session only.
  fetch(request) {
    const hash = request.headers.get('X-Session');
    if (request.headers.get('Upgrade') !== 'websocket' || !this.checkSession(hash)) return new Response(null, { status: 401 });
    const [page, here] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(here, [hash]);
    return new Response(null, { status: 101, webSocket: page });
  }
  // Pages send nothing, and each message in is billed (at 20 to a request), so a socket that sends one isn't a page: closed.
  webSocketMessage(ws) { try { ws.close(1008, 'no messages'); } catch {} }
  webSocketClose(ws, code, reason) { try { ws.close(code, reason); } catch {} }

  #count() { return this.sql.exec('SELECT COUNT(*) AS n FROM sessions').one().n; }
  // A device joins. `joining`: by a code, which only works for a sync that still has a device (checked in this same call, so
  // the sync can't end between the check and the join).
  addSession(hash, label, joining = false) {
    if (joining && !this.#count()) return false;
    const now = Date.now();
    this.sql.exec('INSERT INTO sessions VALUES (?, ?, ?)', hash, label, now);
    this.#arm();
    this.#tell('devices', hash);
    return true;
  }
  // Whether a session is valid, noting when it was last used (at most hourly, to spare writes; sync() notes every sync).
  checkSession(hash) {
    const row = this.sql.exec('SELECT seen FROM sessions WHERE hash = ?', hash).toArray()[0];
    if (!row) return false;
    const now = Date.now();
    if (now - row.seen > DAY / 24) {
      this.sql.exec('UPDATE sessions SET seen = ? WHERE hash = ?', now, hash);
      this.#arm();
    }
    return true;
  }
  // The reader's devices, for a device that's one of them (null otherwise). A device unused for as long as a cookie lasts
  // can't sync again (its cookie has expired), so it leaves the list.
  devices(hash) {
    if (!this.checkSession(hash)) return null;
    this.sql.exec('DELETE FROM sessions WHERE seen < ?', Date.now() - IDLE);
    return this.sql.exec('SELECT hash, label, seen FROM sessions ORDER BY seen DESC').toArray();
  }
  // A sync needs two devices. With none left nothing could reach its data again (there's no account to sign back in to),
  // and one alone has nothing to sync with, so either way the sync ends: the device keeps its read list, and a new sync
  // code later uploads it again. Returns whether the sync carries on.
  async removeSession(hash) {
    this.sql.exec('DELETE FROM sessions WHERE hash = ?', hash);
    this.#drop(hash);
    if (this.#count() > 1) { this.#tell('devices'); return true; }
    await this.deleteAll();
    return false;
  }
  // Removing a device, asked by one of the reader's devices: whether any is left, or null for a device that isn't one.
  async revoke(hash, id) {
    return this.checkSession(hash) ? this.removeSession(id) : null;
  }

  // Takes a device's changes, keeping each story's newest, and returns what the device hasn't seen: every row changed since
  // its cursor, plus this store's version of any change it turned down, so a device whose clock is off still ends up
  // agreeing. `seq` numbers changes as they arrive here, kept apart from the rows so pruning never reuses a number, and
  // shared by both tables, so one cursor covers marks and stories saved for later.
  // `since`: the earliest first-visit cutoff of the reader's devices (site/app.js), so all of them count the same older
  // stories as read.
  sync(hash, changes, cursor, since, later = {}) {
    if (!this.checkSession(hash)) return null;
    const now = Date.now();
    this.sql.exec('UPDATE sessions SET seen = ? WHERE hash = ?', now, hash);  // every sync, for the device list's "Last synced"
    const was = this.#get('seq') ?? 0;
    if (cursor > was) cursor = 0;  // a cursor from before the reader's data was deleted: start over
    let seq = was;
    // Keeps whichever is newer, the stored row or the device's; `write` stores the device's. Returns the urls turned down.
    const merge = (table, rows, max, write) => {
      const refused = [];
      let n = this.#rows(table);
      for (const [url, row] of Object.entries(rows)) {
        const t = Math.min(row[1], now);  // a clock running ahead can't win every future change
        const had = this.sql.exec(`SELECT at FROM ${table} WHERE url = ?`, url).toArray()[0];
        if (had && had.at >= t) { refused.push(url); continue; }
        if (!had) n++;
        write(url, row, t, ++seq);
      }
      this.#prune(table, n, max, now);
      return refused;
    };
    const refusedMarks = merge('marks', changes, MAX_MARKS, (url, [read, , opened], t, s) => this.sql.exec(`INSERT INTO marks VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (url) DO UPDATE SET read = excluded.read, at = excluded.at, opened = excluded.opened, seq = excluded.seq, touched = excluded.touched`,
      url, read, t, opened, s, now));
    const refusedLater = merge('later', later, MAX_LATER, (url, [saved], t, s) => this.sql.exec(`INSERT INTO later VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (url) DO UPDATE SET saved = excluded.saved, at = excluded.at, seq = excluded.seq, touched = excluded.touched`,
      url, saved, t, s, now));
    if (seq !== was) this.#tell('marks', hash);  // the other devices' pages pull
    this.#set('seq', seq);
    this.#arm();
    const kept = this.#get('since');
    if (since && (!kept || since < kept)) this.#set('since', since);
    const unseen = (cols, table, refused) => {  // what the device has not seen: changed since its cursor, or turned down
      const rows = this.sql.exec(`SELECT ${cols} FROM ${table} WHERE seq > ? ORDER BY seq`, cursor).toArray();
      for (const url of refused) rows.push(...this.sql.exec(`SELECT ${cols} FROM ${table} WHERE url = ?`, url).toArray());
      return rows;
    };
    return {
      marks: Object.fromEntries(unseen('url, read, at, opened', 'marks', refusedMarks).map(r => [r.url, [r.read, r.at, r.opened]])),
      later: Object.fromEntries(unseen('url, saved, at', 'later', refusedLater).map(r => [r.url, [r.saved, r.at]])),
      cursor: seq, since: this.#get('since'),
    };
  }

  // ponytail: recreating the tables leaves a few KB of empty storage behind if a stale cookie later reaches a deleted
  // reader (it's cleared on that same request); add an alarm for empty readers if that ever shows up in storage use.
  async deleteAll() {
    this.#drop();  // every open page hears it's no longer syncing
    await this.ctx.storage.deleteAll();  // the alarm too
    this.#schema();  // this instance can outlive its data; later calls find empty tables, not missing ones
  }
  // No device has used sync for as long as a cookie lasts: every cookie has expired, so the reader goes. Otherwise it's marks
  // and saves untouched for as long as they're kept (#arm).
  async alarm() {
    const now = Date.now();
    if (!(this.sql.exec('SELECT MAX(seen) AS t FROM sessions').one().t > now - IDLE)) return this.deleteAll();
    for (const t of ['marks', 'later']) this.#prune(t, this.#rows(t), Infinity, now);
    this.#arm();
  }
}

// Codes for adding a device: each names a reader, works once and lasts ten minutes. A Durable Object is consistent
// everywhere, so a code made on one device works at once on another. One instance; it's never busy.
export class Codes extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, user TEXT NOT NULL, expires INTEGER NOT NULL)');
  }
  put(code, user, expires) {
    this.sql.exec('DELETE FROM codes WHERE expires < ?', Date.now());
    this.sql.exec('INSERT INTO codes VALUES (?, ?, ?)', code, user, expires);
  }
  take(code) {
    const row = this.sql.exec('SELECT user FROM codes WHERE code = ? AND expires >= ?', code, Date.now()).toArray()[0];
    this.sql.exec('DELETE FROM codes WHERE code = ?', code);
    return row?.user ?? null;
  }
}

export default { fetch: account };  // reached only through the site's Worker: it has no route or workers.dev address
