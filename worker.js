// The Worker behind upshot.levine.io. Files come straight from site/; this runs only for the reader's /api/read, for
// read-state sync's /api/sync and /api/auth/* (passed to sync/), and for pages (run_worker_first in wrangler.jsonc).
// Extraction happens in the build (extract.mjs), because parsing a page costs far more CPU than a request is allowed.
// Only stored articles can come back.
export async function keyFor(url) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function read(request, env) {
  const url = new URL(request.url).searchParams.get('url');
  const stored = url && env.ARTICLES && await env.ARTICLES.get(await keyFor(url));  // passed through unparsed, to stay cheap
  return new Response(stored || JSON.stringify({ url, frameable: false, reason: 'pending' }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Read-state sync lives in its own Worker, upshot-sync (sync/), reached over a service binding. Every page load asks
// /api/sync whether it's signed in; without a session cookie the answer is no, given here so that visitors who never
// sign in never start that Worker.
function toSync(request, env) {
  const signedOut = !/(?:^|;\s*)upshot_session=/.test(request.headers.get('Cookie') || '');
  if (new URL(request.url).pathname === '/api/sync' && request.method === 'POST' && signedOut) return Response.json({ signedIn: false }, { headers: { 'Cache-Control': 'no-store' } });
  return env.SYNC ? env.SYNC.fetch(request) : Response.json({ error: 'sync is off' }, { status: 503 });  // a fork without it
}

// The site's fonts (Söhne, Mercury Text and Mercury Display) are licensed, so they can't be in this public repo with the
// rest of site/. They live in a private R2 bucket (upshot-fonts; docs/setup.md) and are served from here, on the site's
// own origin. A week's cache: a replaced file reaches browsers within that, or at once under a new name. The URLs have
// no extension, so the Worker runs for them (run_worker_first in wrangler.jsonc); the bucket's keys are the file names,
// with .woff2.
const FONT_PREFIX = '/fonts/licensed/';
// The licences ask that the fonts serve only to style text: no hotlinking (the CORS header below) and no direct download.
// Browsers say what a request is for, so a font opened as a page, from the address bar or a link, gets nothing; the
// page's @font-face and preload ask for a font, and its fetch for the reader frame for nothing in particular ("empty").
// A client that doesn't say (curl, older browsers) is let through: refusing it would stop no one and break the fonts.
const FONT_USES = new Set(['font', 'empty']);
async function font(request, path, env) {
  const dest = request.headers.get('Sec-Fetch-Dest');
  if (dest && !FONT_USES.has(dest)) return new Response('Forbidden', { status: 403 });
  const obj = env.FONTS && await env.FONTS.get(path.slice(FONT_PREFIX.length) + '.woff2');
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'font/woff2', ETag: obj.httpEtag, 'Cache-Control': 'public, max-age=604800',
      // The reader frame is sandboxed, so its requests carry Origin: null. Allowing only that, rather than *, serves the
      // frame (and the page itself, which needs no CORS) while other sites' pages can't use the fonts.
      'Access-Control-Allow-Origin': 'null',
    },
  });
}

// Cloudflare's Bot Fight Mode injects an inline script into pages, and tags it with the CSP's nonce if there is one.
// Our own inline scripts are allowed by hash (site/_headers); the fresh nonce is only for Cloudflare's.
function withNonce(res) {
  const csp = res.headers.get('Content-Security-Policy');
  if (!csp || !res.headers.get('Content-Type')?.startsWith('text/html')) return res;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const out = new Response(res.body, res);
  out.headers.set('Content-Security-Policy', csp.replace('script-src ', `script-src 'nonce-${nonce}' `));
  return out;
}

// GitHub's own scheduler starts the build late or skips it under load; Cloudflare's cron (wrangler.jsonc) fires on
// time, so it starts the build instead, and the GitHub schedule stays as a fallback. A fork without the token skips it.
export async function dispatchBuild(env) {
  if (!env.GITHUB_DISPATCH_TOKEN) return;
  const res = await fetch(`https://api.github.com/repos/${env.BUILD_REPO}/actions/workflows/build.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'upshot-worker',  // GitHub rejects requests without one
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!res.ok) throw new Error(`build dispatch failed: ${res.status} ${await res.text()}`);  // lands in Workers Logs
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/read') return read(request, env);
    if (path === '/api/sync' || path.startsWith('/api/auth/')) return toSync(request, env);
    if (path.startsWith(FONT_PREFIX)) return font(request, path, env);
    return withNonce(await env.ASSETS.fetch(request));
  },
  async scheduled(event, env) {
    await dispatchBuild(env);
  },
};
