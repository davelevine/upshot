// The Worker behind upshot.me. Files come straight from site/; this runs only for the reader's /api/read, for
// read-state sync's /api/sync and /api/auth/* (passed to sync/), and for pages (run_worker_first in wrangler.jsonc).
// Extraction happens in the build (extract.mjs), because parsing a page costs far more CPU than a request is allowed.
// Only stored articles can come back.
export async function keyFor(url) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function read(request, env) {
  const url = new URL(request.url).searchParams.get('url');
  // Passed through unparsed, to stay cheap; the metadata the build writes says whether it's an article.
  const { value: stored, metadata } = (url && env.ARTICLES && await env.ARTICLES.getWithMetadata(await keyFor(url))) || {};
  // An article is kept a day: it changes only when the extractor's version does. Anything else (pending, or blocked this
  // time) may be an article after the next build, so it's never kept.
  const cache = stored && metadata?.reason === 'ok' ? 'private, max-age=86400' : 'no-store';
  return new Response(stored || JSON.stringify({ url, reason: 'pending' }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
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
// rest of site/. They live in a private R2 bucket (upshot-fonts; docs/setup/configuration.md) and are served from here, on the site's
// own origin. Cached for a year, so a changed font needs a new name (docs/setup/configuration.md). The URLs have
// no extension, so the Worker runs for them (run_worker_first in wrangler.jsonc); the bucket's keys are the file names,
// with .woff2.
const FONT_PREFIX = '/fonts/licensed/';
// The licenses ask that the fonts serve only to style text: no hotlinking (the CORS header below) and no direct download.
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
      // A year, never rechecked: a changed font gets a new name (docs/setup/configuration.md), so a URL's file never changes.
      'Content-Type': 'font/woff2', ETag: obj.httpEtag, 'Cache-Control': 'public, max-age=31536000, immutable',
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

// Reader links (/read/<slug>) serve the home page (site/_redirects), so a shared link would unfurl as the site. This names
// the story instead: its headline and summary in the title, description and link-preview tags. The slug rules are
// app.js's; tests/read.test.js keeps the two in step.
const slugBase = t => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ'’]/g, '').replace(/[^a-z0-9]+/g, ' ')
  .trim().split(' ').slice(0, 8).join('-').slice(0, 60).replace(/-+$/, '');
const shortHash = s => { let h = 5381; for (const c of s) h = (h * 33 + c.charCodeAt(0)) >>> 0; return h.toString(36).slice(0, 5); };
export function storyFor(items, slug) {
  const count = new Map();
  for (const i of items) count.set(slugBase(i.title), (count.get(slugBase(i.title)) || 0) + 1);
  return items.find(i => {
    const base = slugBase(i.title);
    return (base && count.get(base) === 1 ? base : [base, shortHash(i.url)].filter(Boolean).join('-')) === slug;
  });
}
async function storyPage(request, env, res) {
  const url = new URL(request.url);
  let slug;
  try { slug = decodeURIComponent(url.pathname.slice('/read/'.length)); } catch { return res; }
  const data = await env.ASSETS.fetch(new URL('/data.json', url)).then(r => r.json()).catch(() => null);
  const item = data && storyFor(data.items || [], slug);
  if (!item || !res.headers.get('Content-Type')?.startsWith('text/html')) return res;
  const content = v => ({ element: el => el.setAttribute('content', v) });
  const here = attr => ({ element: el => el.setAttribute(attr, new URL(url.pathname, el.getAttribute(attr)).href) });  // the site's own address, read from the page
  return new HTMLRewriter()
    .on('title', { element: el => el.setInnerContent(`${item.title} · Upshot`) })
    .on('meta[name="description"]', content(item.summary))
    .on('meta[property="og:type"]', content('article'))
    .on('meta[property="og:title"]', content(item.title))
    .on('meta[property="og:description"]', content(item.summary))
    .on('meta[property="og:url"]', here('content'))
    .on('link[rel="canonical"]', here('href'))
    .on('meta[property^="og:image"]', { element: el => el.remove() })  // the card shows the week's #1, not this story
    .on('meta[name="twitter:card"]', content('summary'))
    .transform(res);
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
    const res = await env.ASSETS.fetch(request);
    return withNonce(path.startsWith('/read/') ? await storyPage(request, env, res) : res);
  },
  async scheduled(event, env) {
    await dispatchBuild(env);
  },
};
