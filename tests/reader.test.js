// The sync Worker's Durable Objects (sync/worker.js) against a real SQLite (node:sqlite) and a clock the tests move, so
// rules that play out over minutes or months (a lone sync's deadline, the idle alarm) are checked directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// `cloudflare:workers` exists only in the Workers runtime: a stand-in DurableObject that keeps ctx and env.
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }', shortCircuit: true };
    return next(spec, ctx);
  }`));
const { Reader } = await import('../sync/worker.js');

let now = 1_800_000_000_000;
Date.now = () => now;
const MIN = 60e3, DAY = 864e5;

// Just enough of a Durable Object's state: SQL, one alarm, and hibernatable WebSockets with tags.
function reader() {
  const db = new DatabaseSync(':memory:');
  const sockets = [];
  const cursor = rows => ({ toArray: () => rows, one: () => rows[0] });
  const ctx = {
    alarm: null,
    storage: {
      sql: {
        exec(q, ...args) {
          if (!args.length && q.split(';').filter(x => x.trim()).length > 1) { db.exec(q); return cursor([]); }
          const st = db.prepare(q);
          return /^\s*(SELECT|EXPLAIN)|RETURNING/i.test(q) ? cursor(st.all(...args).map(r => ({ ...r }))) : (st.run(...args), cursor([]));
        },
      },
      setAlarm: t => { ctx.alarm = t; },
      deleteAll: async () => {
        for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) db.exec(`DROP TABLE ${name}`);
        ctx.alarm = null;
      },
    },
    getWebSockets: tag => sockets.filter(s => !tag || s.tag === tag),
    getTags: ws => [ws.tag],
  };
  const r = new Reader(ctx, {});
  r.socket = tag => { const s = { tag, sent: [], closed: null, send(m) { this.sent.push(JSON.parse(m).t); }, close(c) { this.closed = c; } }; sockets.push(s); return s; };
  r.ctx = ctx;
  return r;
}

test('a sync ends after 400 days unused, and each use moves that out', async () => {
  const r = reader(), page = r.socket('a');
  r.addSession('a', 'Firefox on Mac');
  assert.equal(r.ctx.alarm, now + 400 * DAY);
  now += 30 * DAY;
  r.checkSession('a');
  assert.equal(r.ctx.alarm, now + 400 * DAY, 'used: the clock restarts');
  now = r.ctx.alarm;
  await r.alarm();
  assert.equal(r.devices('a'), null, 'gone');
  assert.equal(page.closed, 4001);
  assert.deepEqual(page.sent, ['ended'], 'told before the close');
});

test('joining by code fails once the sync has no device, without bringing it back', () => {
  const r = reader();
  assert.equal(r.addSession('b', 'Chrome on Android', true), false);
  assert.equal(r.devices('b'), null);
});

test('a removal that leaves one device ends the sync for both', async () => {
  const r = reader(), a = r.socket('a'), b = r.socket('b');
  r.addSession('a', 'A'); r.addSession('b', 'B', true);
  assert.equal(await r.revoke('a', 'b'), false, 'nothing left to sync with');
  assert.equal(b.closed, 4001);
  assert.equal(a.closed, 4001);
  assert.equal(r.devices('a'), null);

  const s = reader(), x = s.socket('x');
  s.addSession('x', 'X'); s.addSession('y', 'Y', true); s.addSession('z', 'Z', true);
  assert.equal(await s.revoke('x', 'z'), true, 'three devices: the other two carry on');
  assert.equal(x.closed, null);
  assert.ok(x.sent.includes('devices'));
});

test('sync: the newest change wins, refused changes come back, numbers are never reused, the earliest cutoff is kept', () => {
  const r = reader(), u = 'https://x.test/a', other = r.socket('b');
  r.addSession('a', 'A'); r.addSession('b', 'B', true);
  let res = r.sync('a', { [u]: [1, now - 1000, 1] }, 0, '2026-11-01T00:00:00.000Z');
  assert.deepEqual(res.marks[u], [1, now - 1000, 1]);
  assert.equal(res.since, '2026-11-01T00:00:00.000Z');
  assert.ok(other.sent.includes('marks'), 'the other device is told');
  res = r.sync('b', { [u]: [0, now - 5000, 0] }, 0, '2026-10-01T00:00:00.000Z');  // older: refused
  assert.deepEqual(res.marks[u], [1, now - 1000, 1], "the refused device gets the server's version");
  assert.equal(res.since, '2026-10-01T00:00:00.000Z', 'the earlier cutoff');
  const before = res.cursor;
  now += 121 * DAY;  // past the keep window: the mark is pruned
  res = r.sync('a', { 'https://x.test/b': [1, now, 1] }, before, null);
  assert.ok(res.cursor > before, "a pruned row's number isn't handed out again");
  assert.equal(r.sync('a', {}, 0, null).since, '2026-10-01T00:00:00.000Z');
  assert.equal(r.sync('nobody', {}, 0, null), null, 'only for a device of this sync');
});

test('the device list says when each device last synced, to the minute', () => {
  const r = reader();
  r.addSession('a', 'Firefox on Mac');
  r.addSession('b', 'Safari on iPhone');
  now += 10 * MIN;
  r.sync('b', {}, 0, null);
  now += 5 * MIN;
  r.sync('b', {}, 0, null);  // within the hour checkSession waits between writes
  assert.equal(r.devices('a').find(d => d.hash === 'b').seen, now);
});

test("a reader nobody syncs any more loses its marks when they'd be pruned, not 400 days on", async () => {
  const r = reader(), u = 'https://x.test/a';
  r.addSession('a', 'A'); r.addSession('b', 'B', true);
  r.sync('a', { [u]: [1, now, 1] }, 0, null);
  assert.equal(r.ctx.alarm, now + 120 * DAY, 'the oldest mark comes due first');
  now = r.ctx.alarm;
  await r.alarm();
  assert.ok(r.devices('a'), 'the sync carries on');
  assert.deepEqual(r.sync('a', {}, 0, null).marks, {}, 'its stale mark is gone');
  assert.equal(r.ctx.alarm, now + 400 * DAY, 'no marks left: the idle deadline');
});

test('a reader keeps its newest 2,000 marks, counted without a scan', () => {
  const r = reader();
  r.addSession('a', 'A'); r.addSession('b', 'B', true);
  for (let batch = 0; batch < 7; batch++) {  // 2,100 marks, 300 at a time as the page sends them
    now += 1000;
    r.sync('a', Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`https://x.test/${batch}/${i}`, [1, now, 0]])), 0, null);
  }
  const marks = r.sync('a', {}, 0, null).marks;
  assert.equal(Object.keys(marks).length, 2000);
  assert.ok(!('https://x.test/0/0' in marks) && 'https://x.test/6/299' in marks, 'the oldest went');
});

test('the queries a sync runs on every call use an index, not a scan of every mark', () => {
  const sql = reader().ctx.storage.sql;
  for (const q of ['SELECT url FROM marks WHERE seq > 1', 'DELETE FROM marks WHERE touched <= 1', 'SELECT MIN(touched) FROM marks', 'SELECT url FROM marks ORDER BY at LIMIT 1']) {
    const plan = sql.exec(`EXPLAIN QUERY PLAN ${q}`).toArray().map(r => r.detail).join('; ');
    assert.match(plan, /USING (COVERING )?INDEX/, `${q}: ${plan}`);
  }
});

test('a socket that sends anything is closed: pages send nothing', () => {
  const r = reader(), s = r.socket('a');
  r.webSocketMessage(s, 'x');
  assert.equal(s.closed, 1008);
});
