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

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/read') return read(request, env);
    return withNonce(await env.ASSETS.fetch(request));
  },
};
