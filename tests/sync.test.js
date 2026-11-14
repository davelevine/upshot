import { test } from 'node:test';
import assert from 'node:assert/strict';
import site from '../worker.js';
import { account, deviceLabel, readCookie, validMarks } from '../sync/account.js';

const worker = { fetch: account };  // the upshot-sync Worker's handler

const ORIGIN = 'https://site.test', USER = 'u'.repeat(22), TOKEN = 't'.repeat(43);
const req = (path, { method = 'POST', origin = ORIGIN, cookie, body = '{}' } = {}) => new Request(ORIGIN + path, {
  method, headers: { ...(origin && { Origin: origin }), ...(cookie && { Cookie: cookie }) }, ...(method === 'POST' && { body }),
});
// Durable Object stand-ins that fail the test if called: the paths below must answer without them.
const untouched = { idFromName: () => assert.fail('no Durable Object call expected'), get: () => assert.fail('no Durable Object call expected') };
const env = { READER: untouched, CODES: untouched };

test('readCookie takes only a well-formed reader id and token', () => {
  assert.deepEqual(readCookie(req('/', { cookie: `a=b; upshot_session=${USER}.${TOKEN}; c=d` })), { user: USER, token: TOKEN });
  for (const bad of [`upshot_session=${USER}`, `upshot_session=${USER}.short`, `upshot_session=${USER}!.${TOKEN}`, `other_session=${USER}.${TOKEN}`, ''])
    assert.equal(readCookie(req('/', { cookie: bad })), null, bad);
});

test('deviceLabel names the browser and system', () => {
  const ua = {
    'Safari on iPhone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
    'Chrome on iPhone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
    'Chrome on Mac': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    'Edge on Windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
    'Firefox on Linux': 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Chrome on Android': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  };
  for (const [label, s] of Object.entries(ua)) assert.equal(deviceLabel(s), label);
  assert.equal(deviceLabel(''), 'Browser');
  // Chrome's user agent exactly, but Brave in the client hints; and the Google app's built-in browser, which keeps its own storage.
  assert.equal(deviceLabel(ua['Chrome on Android'], '"Brave";v="131", "Chromium";v="131", "Not_A Brand";v="24"'), 'Brave on Android');
  assert.equal(deviceLabel(ua['Chrome on Android'], '"Google Chrome";v="131", "Chromium";v="131"'), 'Chrome on Android');
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36 GSA/15.44'), 'Google app on Android');
});

test('validMarks takes only http(s) stories with a well-formed mark', () => {
  assert.ok(validMarks({ 'https://x.test/a': [1, Date.now(), 0] }));
  assert.ok(validMarks({}));
  for (const bad of [null, [], { 'javascript:x': [1, 1, 1] }, { 'https://x.test/': [2, 1, 1] }, { 'https://x.test/': [1, -1, 1] },
    { 'https://x.test/': [1, 1] }, { 'https://x.test/': [1, 1.5, 0] }, { ['https://x.test/' + 'x'.repeat(2048)]: [1, 1, 1] },
    Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`https://x.test/${i}`, [1, 1, 1]]))]) assert.equal(validMarks(bad), false);
});

test('signed out costs no Durable Object call, and sync says so without an error status', async () => {
  const res = await worker.fetch(req('/api/sync', { body: '{"marks":{},"cursor":0}' }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { signedIn: false });
  assert.deepEqual(await (await worker.fetch(req('/api/auth/me', { method: 'GET', origin: null }), env)).json(), { signedIn: false });
  assert.equal((await worker.fetch(req('/api/auth/devices/revoke'), env)).status, 401);
  assert.match((await worker.fetch(req('/api/auth/logout'), env)).headers.get('Set-Cookie'), /upshot_session=; Path=\/api; Max-Age=0; HttpOnly; Secure; SameSite=Lax/);
});

test('cross-site, wrong-method and unknown requests are refused before anything else', async () => {
  assert.equal((await worker.fetch(req('/api/sync', { origin: 'https://evil.test' }), env)).status, 403);
  assert.equal((await worker.fetch(req('/api/auth/start', { origin: null }), env)).status, 403);
  assert.equal((await worker.fetch(req('/api/sync', { method: 'GET' }), env)).status, 405);
  assert.equal((await worker.fetch(req('/api/auth/nope'), env)).status, 404);
  assert.equal((await worker.fetch(req('/api/auth/constructor'), env)).status, 404);  // not an inherited property
  assert.equal((await worker.fetch(req('/api/sync'), {})).status, 503);  // a fork without the sync Worker
});

test('the auth rate limit answers 429 per address', async () => {
  const seen = [];
  const limited = { ...env, AUTH_LIMIT: { limit: async ({ key }) => { seen.push(key); return { success: false }; } } };
  const r = new Request(ORIGIN + '/api/auth/start', { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.9' }, body: '{}' });
  assert.equal((await worker.fetch(r, limited)).status, 429);
  assert.deepEqual(seen, ['203.0.113.9']);
  // No visitor address, or loopback (wrangler dev reports 127.0.0.1; Cloudflare never does): not limited, rather than one shared key.
  assert.equal((await worker.fetch(new Request(ORIGIN + '/api/auth/link/finish', { method: 'POST', headers: { Origin: ORIGIN }, body: '{"code":"x"}' }), limited)).status, 200);
  for (const ip of ['127.0.0.1', '::1'])
    assert.equal((await worker.fetch(new Request(ORIGIN + '/api/auth/link/finish', { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip }, body: '{"code":"x"}' }), limited)).status, 200, ip);
  assert.deepEqual(seen, ['203.0.113.9']);
  // Signed-in, routine calls aren't limited either.
  assert.equal((await worker.fetch(new Request(ORIGIN + '/api/auth/me', { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), limited)).status, 200);
  assert.deepEqual(seen, ['203.0.113.9']);
});

test('the site answers signed-out sync itself, and forwards the rest to upshot-sync', async () => {
  const forwarded = [];
  const env = { SYNC: { fetch: async r => { forwarded.push(new URL(r.url).pathname); return new Response('{}'); } } };
  assert.deepEqual(await (await site.fetch(req('/api/sync', { body: '{"marks":{},"cursor":0}' }), env)).json(), { signedIn: false });
  assert.deepEqual(forwarded, []);  // visitors who never sign in never start the sync Worker
  await site.fetch(req('/api/sync', { cookie: `upshot_session=${USER}.${TOKEN}` }), env);
  await site.fetch(req('/api/auth/start'), env);
  assert.deepEqual(forwarded, ['/api/sync', '/api/auth/start']);
  assert.equal((await site.fetch(req('/api/auth/me', { method: 'GET' }), {})).status, 503);  // a fork without upshot-sync
});

test('device codes: typed loosely, refused quietly, and only for a signed-in device to make', async () => {
  const { normalCode } = await import('../sync/account.js');
  assert.equal(normalCode(' k7qf-m2xa '), 'K7QFM2XA');
  assert.equal(normalCode('oil0 0000'), '01100000');
  // A malformed code is answered without a Durable Object call, and with 200: browsers log every 4xx.
  const res = await worker.fetch(req('/api/auth/link/finish', { body: '{"code":"abc"}' }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: false });
  assert.equal((await worker.fetch(req('/api/auth/link/start'), env)).status, 401);
});
