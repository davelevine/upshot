// Read-state sync's devices and /api/sync (docs/architecture.md). There's no account, email or password.
// A reader is a random id; each of their devices holds a session for it. The first device turns sync on; every other one
// joins with a short code shown on a device that's already syncing. State lives in the reader's own Durable Object
// (worker.js, beside this). The site's Worker forwards /api/auth/* and /api/sync here.
import { generate } from 'lean-qr';
import { toSvgSource } from 'lean-qr/extras/svg';

const keyFor = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

const COOKIE = 'upshot_session', COOKIE_AGE = 400 * 86400;  // 400 days, the longest Chrome allows; renewed with use
const USER = /^[A-Za-z0-9_-]{22}$/, TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_BODY = 128 * 1024, MAX_MARKS = 2000;
// What a script could guess at or pile up, rate limited per address: new readers, and codes entered. Not the signed-in
// calls, such as the device list the "Add a device" view checks every few seconds.
const LIMITED = new Set(['start', 'link/finish']);

const CODE_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// What a reader types: any case, with or without the dash, O for 0 and I or L for 1.
export const normalCode = s => String(s).toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
// `cookies`: Set-Cookie values, each its own header.
const json = (body, status = 200, cookies = []) => {
  const res = Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  for (const c of cookies) res.headers.append('Set-Cookie', c);
  return res;
};
const fail = (status, error) => json({ error }, status);

const readerOf = (env, user) => env.READER.get(env.READER.idFromName(user));
const codes = env => env.CODES.get(env.CODES.idFromName('all'));

// The cookie is `<reader id>.<token>`: the id says which Durable Object to ask, and only the token's hash is stored there.
// HttpOnly, so page script can't read it; server-set, so Safari's 7-day clearing of script storage leaves it alone.
export function readCookie(request) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)upshot_session=([^;]*)/);
  const [user, token] = (m?.[1] || '').split('.');
  return USER.test(user || '') && TOKEN.test(token || '') ? { user, token } : null;
}
// With it goes `upshot_sync=1`, which holds no secret and which the page can read: it says whether to ask /api/sync at all,
// so visitors who never sync cost no request. Set by the server, so Safari's weekly clearing of script storage spares it too.
const cookies = (value, age) => [`${COOKIE}=${value}; Path=/api; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`,
  `upshot_sync=${value ? 1 : ''}; Path=/; Max-Age=${age}; Secure; SameSite=Lax`];
const clearCookie = cookies('', 0);

// "Safari on iPhone": enough to tell one's devices apart in the list. Not used for anything else. Brave, Opera and others
// send Chrome's user agent word for word but name themselves in Sec-CH-UA; an app's built-in browser (the Google app's,
// which a scanned QR code can open in) marks itself with GSA/ or "; wv)". Those keep their own storage, so naming them
// tells a reader which of their browsers is syncing.
export function deviceLabel(ua = '', hints = '') {
  const brand = /"Brave"/.test(hints) ? 'Brave' : /"Opera"/.test(hints) ? 'Opera' : /"Microsoft Edge"/.test(hints) ? 'Edge' : null;
  const browser = /GSA\//.test(ua) ? 'Google app' : /; wv\)/.test(ua) ? 'App browser' : brand
    ?? (/Edg\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

// A response for a device whose session is gone (removed elsewhere, or the sync deleted): account() clears its cookies.
const gone = new WeakSet(), goneRes = res => (gone.add(res), res);
// A new session for this device. `joining` (by a code): null if the sync has no device left by now.
async function startSession(request, env, user, joining = false) {
  const token = random(32);
  const ok = await readerOf(env, user).addSession(await keyFor(token), deviceLabel(request.headers.get('User-Agent') || '', request.headers.get('Sec-CH-UA') || ''), joining);
  return ok ? cookies(`${user}.${token}`, COOKIE_AGE) : null;
}

// State-changing requests must come from the site's own pages. Either scheme is accepted for the request's host because
// a dev proxy (wrangler dev behind tailscale serve) reports http for a page loaded over https; no other site's page can
// claim this host either way.
const sameSite = request => {
  const host = new URL(request.url).host;
  return [`https://${host}`, `http://${host}`].includes(request.headers.get('Origin'));
};

async function body(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

const isMark = m => Array.isArray(m) && m.length === 3 && (m[0] === 0 || m[0] === 1) && (m[2] === 0 || m[2] === 1)
  && Number.isSafeInteger(m[1]) && m[1] >= 0;
export const validMarks = marks => !!marks && typeof marks === 'object' && !Array.isArray(marks)
  && Object.keys(marks).length <= MAX_MARKS
  && Object.entries(marks).every(([u, m]) => u.length <= 2048 && /^https?:\/\//.test(u) && isMark(m));

const routes = {
  // Turning sync on: a new reader, with this device as its first.
  async start(request, env, me) {
    if (me && await readerOf(env, me.user).checkSession(me.hash)) return json({ ok: true });
    return json({ ok: true }, 200, await startSession(request, env, random(16)));
  },
  // Adding a device: one that's syncing shows a code, the new one enters it. As Signal and WhatsApp link devices, and TVs
  // sign in. Eight characters of Crockford's base32 (no I, L, O or U) is 2^40 codes, against ten minutes and the rate
  // limit; each works once.
  // With it, a QR code of a link that enters the code, for a phone's camera (WhatsApp Web and Signal Desktop pair this way).
  // The page sends its own address, because behind a dev proxy this request can say http where the browser said https; it
  // must be this host. Black on white with a quiet zone, whatever the theme: some cameras won't read an inverted code.
  async 'link/start'(request, env, me) {
    if (!me || !await readerOf(env, me.user).checkSession(me.hash)) return goneRes(fail(401, 'signed out'));
    const code = [...crypto.getRandomValues(new Uint8Array(8))].map(b => CODE_CHARS[b & 31]).join(''), expires = Date.now() + 10 * 60e3;
    await codes(env).put(code, me.user, expires);
    const b = await body(request);
    let qr;
    try {
      const base = new URL(b?.base);
      if (/^https?:$/.test(base.protocol) && base.host === new URL(request.url).host) {
        qr = toSvgSource(generate(`${base.origin}/#sync=${code.slice(0, 4)}-${code.slice(4)}`), { on: '#000', off: '#fff', pad: 4 });
      }
    } catch {}  // no usable address: the code alone still works
    return json({ code, expires, qr });
  },
  // A device that's already syncing can enter a code too: it leaves its sync (deleted, if it was the only device) and
  // joins this one. Turning sync on in two places by mistake is then one code away from fixed.
  async 'link/finish'(request, env, me) {
    const b = await body(request);
    const code = normalCode(b?.code ?? '');
    const user = code.length === 8 && await codes(env).take(code);
    // A wrong code is an ordinary answer, not an error status, which browsers would log. So is a code for a sync whose last
    // device left after making it: that sync is gone.
    if (!user) return json({ ok: false });
    if (me?.user === user) return json({ ok: true });  // already in it
    const joined = await startSession(request, env, user, true);
    if (!joined) return json({ ok: false });
    if (me) await readerOf(env, me.user).removeSession(me.hash);  // left only once the new sync has it
    return json({ ok: true }, 200, joined);
  },
  async logout(request, env, me) {
    if (me) await readerOf(env, me.user).removeSession(me.hash);
    return json({ ok: true }, 200, clearCookie);
  },
  // Signed in or not, and the reader's devices, this one first. The session hashes double as ids; a hash can't be turned
  // back into a token.
  async me(request, env, me) {
    const list = me && await readerOf(env, me.user).devices(me.hash);
    if (!list) return goneRes(json({ signedIn: false }));
    const devices = list.map(s => ({ id: s.hash, label: s.label, seen: s.seen, current: s.hash === me.hash })).sort((a, b) => b.current - a.current);
    return json({ signedIn: true, devices });
  },
  async 'devices/revoke'(request, env, me) {
    if (!me) return fail(401, 'signed out');
    const b = await body(request);
    if (typeof b?.id !== 'string') return fail(400, 'bad id');
    const left = await readerOf(env, me.user).revoke(me.hash, b.id);
    if (left == null) return goneRes(fail(401, 'signed out'));
    return json({ ok: true, left }, 200, b.id === me.hash || !left ? clearCookie : []);  // !left: the sync ended, this device's too
  },
  // The page's live connection: a WebSocket to the reader's Durable Object, which checks the session (worker.js, fetch).
  async live(request, env, me) {
    if (!me || request.headers.get('Upgrade') !== 'websocket') return goneRes(fail(401, 'signed out'));
    const forward = new Request(request);
    forward.headers.set('X-Session', me.hash);
    const res = await readerOf(env, me.user).fetch(forward);
    return res.status === 401 ? goneRes(fail(401, 'signed out')) : res;
  },
};

// /api/sync: a device's changes in, everyone else's out (worker.js, Reader.sync). Every page load asks, signed in or not,
// so signed out is an ordinary answer rather than a 401, which browsers would log as an error on every visit.
async function sync(request, env, me) {
  if (!me) return json({ signedIn: false });
  const b = await body(request);
  if (!b || !validMarks(b.marks) || !Number.isSafeInteger(b.cursor) || b.cursor < 0) return fail(400, 'bad request');
  const since = typeof b.since === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/.test(b.since) ? b.since : null;  // UTC ISO dates compare as text
  const res = await readerOf(env, me.user).sync(me.hash, b.marks, b.cursor, since);
  if (!res) return goneRes(json({ signedIn: false }));
  return json(res, 200, cookies(`${me.user}.${me.token}`, COOKIE_AGE));  // renewed on every sync: a device in use never expires
}

export async function account(request, env) {
  if (!env.READER || !env.CODES) return fail(503, 'sync is off');
  const path = new URL(request.url).pathname, name = path.slice('/api/auth/'.length);
  const route = path === '/api/sync' ? sync : path.startsWith('/api/auth/') && Object.hasOwn(routes, name) ? routes[name] : null;
  if (!route) return fail(404, 'not found');
  const get = (name === 'me' || name === 'live') && request.method === 'GET';
  if (!get && request.method !== 'POST') return fail(405, 'POST only');
  // Cross-site requests: SameSite=Lax keeps the cookie off them, and this refuses any that get here anyway. A WebSocket
  // opened from another site's page would carry its Origin, so the live connection is held to the same rule.
  if ((!get || name === 'live') && !sameSite(request)) return fail(403, 'cross-site');
  // Per visitor address, which Cloudflare puts on every request it serves. Local dev (wrangler dev reports 127.0.0.1 for
  // everything) and tests would otherwise share one key and trip a limit meant for one person; Cloudflare never reports a
  // loopback address for a real visitor, so those, and requests with none, aren't limited.
  const ip = request.headers.get('CF-Connecting-IP');
  if (LIMITED.has(name) && env.AUTH_LIMIT && ip && !/^(127\.|::1$)/.test(ip)) {
    const { success } = await env.AUTH_LIMIT.limit({ key: ip });
    if (!success) return fail(429, 'too many requests');
  }
  // The cookie names the reader and the session; each route has the reader's Durable Object check the session in the same
  // call that does the work. No cookie, no call. A cookie whose session is gone (removed elsewhere, or deleted) is cleared.
  const c = readCookie(request), me = c && { ...c, hash: await keyFor(c.token) };
  const res = await route(request, env, me);
  if (c && gone.has(res) && !res.headers.has('Set-Cookie')) for (const v of clearCookie) res.headers.append('Set-Cookie', v);
  return res;
}
