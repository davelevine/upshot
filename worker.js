// The Worker behind upshot.levine.io. Files come straight from site/; this runs only for the reader's /api/read and for
// pages (run_worker_first in wrangler.jsonc). Extraction happens in the build (extract.mjs), because parsing a page
// costs far more CPU than a request is allowed. Only stored articles can come back.
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

// The site's fonts (Söhne, Mercury Text and Mercury Display) are licensed, so they can't be in this public repo with the
// rest of site/. They live in a private R2 bucket (upshot-fonts; docs/setup.md) and are served from here, on the site's
// own origin. A week's cache: a replaced file reaches browsers within that, or at once under a new name. The URLs have
// no extension, so the Worker runs for them (run_worker_first in wrangler.jsonc); the bucket's keys are the file names,
// with .woff2.
const FONT_PREFIX = '/fonts/licensed/';
async function font(path, env) {
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
    if (path.startsWith(FONT_PREFIX)) return font(path, env);
    return withNonce(await env.ASSETS.fetch(request));
  },
  async scheduled(event, env) {
    await dispatchBuild(env);
  },
};
