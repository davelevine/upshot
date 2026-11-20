// Listen's text: each story as the blocks the reader's frame marks while its audio plays (the relay in site/app.js), so
// the timings audio.py records line up with what's on screen. The frame shows the headline, the upshot box, then the
// stored article, or for an article that couldn't be stored, its card's summary; this builds the same page and reads
// the blocks the same way.
// stdin: {items: [{url, title, tldr, summary}]}. stdout: {url: {reason, blocks: [{kind, text}]}}, reason as in KV
// ('pending' for nothing stored yet).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { kvClient } from './extract.mjs';
import { keyFor } from './worker.js';

// The frame's rule (SWIPE_REPORTER in site/app.js): these elements are blocks, except one inside another, which is read
// with it, and one with no text.
export const BLOCKS = 'main :is(h1, h2, h3, h4, h5, h6, p, li, blockquote, dd), .todo';
export const INSIDE = 'p, li, blockquote, dd, .todo';

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// The blocks of a story's reader page. `html` is the stored article, or null for its card (the summary).
export function blocksFor({ title, tldr = [], summary = '' }, html) {
  const box = tldr.length ? `<div class="todo"><b>The upshot</b><ul>${tldr.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
  const body = html ?? (summary ? `<div><p>${esc(summary)}</p></div>` : '');
  const { document } = parseHTML(`<!doctype html><html><body><main><h1>${esc(title)}</h1>${box}${body}</main></body></html>`);
  return [...document.querySelectorAll(BLOCKS)]
    .filter(n => !n.parentElement.closest(INSIDE) && n.textContent.trim())
    .map(n => {
      const kind = n.tagName === 'H1' ? 'title' : /^H[2-6]$/.test(n.tagName) ? 'head' : n.matches('.todo') ? 'upshot' : 'text';
      return { kind, text: kind === 'upshot' ? ['The upshot.', ...tldr].join(' ') : n.textContent.replace(/\s+/g, ' ').trim() };
    });
}

// Each story's blocks, from what the build stored in KV: one list call says which are stored, blocked or not there yet.
export async function storyBlocks(items, kv) {
  const stored = await kv.list();
  const out = {};
  for (const i of items) {
    const reason = stored.get(await keyFor(i.url))?.reason || 'pending';
    if (reason === 'pending') { out[i.url] = { reason, blocks: [] }; continue; }
    const record = reason === 'ok' ? await kv.get(await keyFor(i.url)) : null;
    out[i.url] = { reason, blocks: blocksFor(i, record?.content ?? null) };
  }
  return out;
}

// The same records from the site's public reader (/api/read, worker.js), for a dry run: a pull request gets no token.
export function siteStore(site, items, get = fetch) {
  const records = new Map();
  return {
    async list() {
      for (const i of items) {
        const r = await get(`${site}/api/read?url=${encodeURIComponent(i.url)}`).then(res => res.json()).catch(() => null);
        if (r?.reason && r.reason !== 'pending') records.set(await keyFor(i.url), r);
      }
      return records;
    },
    get: async key => records.get(key),
  };
}

async function main() {
  const { items } = JSON.parse(readFileSync(0, 'utf8'));
  const kv = process.env.AUDIO_DRY_RUN ? siteStore((process.env.SITE_URL || 'https://upshot.me').replace(/\/$/, ''), items) : kvClient(process.env);
  if (!kv) throw new Error('no KV credentials (CF_API_TOKEN, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID)');
  process.stdout.write(JSON.stringify(await storyBlocks(items, kv)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
