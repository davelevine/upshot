// The Worker behind upshot.levine.io. Files come straight from site/; this runs only for the reader's /api/read, the
// licensed fonts, and pages (run_worker_first in wrangler.jsonc). Extraction happens in the build (extract.mjs), because parsing a page
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

// Klim's licensed webfonts live in a private R2 bucket, never in this repository. Only these files can come back, so the
// binding can't expose the rest of the bucket. No extension in the URL: run_worker_first skips every path with a dot.
const FONTS = { UntitledSansWeb: 'woff', UntitledSerifWeb: 'woff2' };
const STYLES = { UntitledSansWeb: ['Regular', 'Medium', 'Bold'], UntitledSerifWeb: ['Regular', 'RegularItalic', 'Medium', 'Bold', 'BoldItalic'] };

async function font(name, request, env) {
  const [family, style] = name.split('-');
  const obj = STYLES[family]?.includes(style) && env.FONTS && await env.FONTS.get(`uploads/fonts/untitled/${name}.${FONTS[family]}`);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = { 'Content-Type': `font/${FONTS[family]}`, 'Cache-Control': 'public, max-age=2592000', ETag: obj.httpEtag, Vary: 'Origin' };
  // Same-origin pages need no CORS. The reader frame's opaque origin sends "null"; other sites get nothing, so can't hotlink.
  if (request.headers.get('Origin') === 'null') headers['Access-Control-Allow-Origin'] = 'null';
  return new Response(obj.body, { headers });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/read') return read(request, env);
    if (pathname.startsWith('/fonts/untitled/')) return font(pathname.slice(16), request, env);
    return withNonce(await env.ASSETS.fetch(request));
  },
};
