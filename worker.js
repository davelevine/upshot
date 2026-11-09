// The Worker behind upshot.levine.io. Everything is a static asset from site/ except /api/read (run_worker_first in
// wrangler.jsonc), which returns the article the build stored. Extraction happens in the build (extract.mjs), because
// parsing a page costs far more CPU than a request is allowed. Only stored articles can come back.
export async function keyFor(url) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url).searchParams.get('url');
    const stored = url && env.ARTICLES && await env.ARTICLES.get(await keyFor(url));  // passed through unparsed, to stay cheap
    return new Response(stored || JSON.stringify({ url, frameable: false, reason: 'pending' }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
