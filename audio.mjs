// Listen's text: each story as the blocks the reader's frame marks while its audio plays (the relay in site/app.js), so
// the timings audio.py records line up with what's on screen. The frame shows the headline, the upshot box, then the
// stored article, or for an article that couldn't be stored, its card's summary; this builds the same page and reads
// the blocks the same way.
// stdin: {items: [{url, title, tldr, summary}]}. stdout: {url: {reason, blocks: [{kind, text}]}}, reason as in KV
// ('pending' for nothing stored yet).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { allText, kvClient } from './extract.mjs';
import { keyFor } from './worker.js';

// The frame's rule (SWIPE_REPORTER in site/app.js): these elements are blocks, except one inside another, which is read
// with it, and one with no text.
export const BLOCKS = 'main :is(h1, h2, h3, h4, h5, h6, p, li, blockquote, dt, dd), .todo';
export const INSIDE = 'p, li, blockquote, dt, dd, .todo';

// The frame's page goes through a browser's HTML parser, where one of these start tags closes an open <p> along with
// everything open inside it, unless one of the SCOPE elements stands between them. linkedom's parser closes the <p>
// only when it's the direct parent, so <p><span><p>a</p><h3>b</h3></span></p> stays one paragraph here and is three
// elements in the frame.
const CLOSES_P = 'address, article, aside, blockquote, center, details, dialog, dir, div, dl, fieldset, figcaption, figure, '
  + 'footer, header, hgroup, main, menu, nav, ol, p, search, section, summary, ul, h1, h2, h3, h4, h5, h6, pre, listing, '
  + 'form, table, hr, li, dd, dt, plaintext, xmp';
const SCOPE = 'applet, button, marquee, object, template';

// Ends each <p> where a browser does: the element that closes it, and all that follows it inside the <p>, move out to
// come after it, without the inline elements that wrapped them. In a browser the text that follows is loose in the
// paragraph's parent too, so it's in no block.
// ponytail: covers <p> only, the one difference on the fixture pages. A heading inside a heading, an <li> straight
// inside an <li>, an <a> inside an <a> and table content outside its cells are parsed differently too; if a stored
// article shows one, parse with an HTML5 parser (parse5) instead of adding rules here.
function closeParagraphs(root) {
  for (const p of root.querySelectorAll('p')) {
    const closer = [...p.querySelectorAll(CLOSES_P)].find(el => !p.contains(el.parentElement.closest(SCOPE)));
    if (!closer) continue;
    const out = [];
    for (let n = closer; n !== p; n = n.parentNode) for (let s = n === closer ? n : n.nextSibling; s; s = s.nextSibling) out.push(s);
    p.after(...out);
  }
}

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// The blocks of a story's reader page. `html` is the stored article, or null for its card (the summary).
export function blocksFor({ title, tldr = [], summary = '' }, html) {
  const box = tldr.length ? `<div class="todo"><b>The upshot</b><ul>${tldr.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
  const body = html ?? (summary ? `<div><p>${esc(summary)}</p></div>` : '');
  const { document } = parseHTML(`<!doctype html><html><body><main><h1>${esc(title)}</h1>${box}${body}</main></body></html>`);
  closeParagraphs(document);
  return [...document.querySelectorAll(BLOCKS)]
    .filter(n => !n.parentElement.closest(INSIDE) && n.textContent.trim())
    .map(n => {
      const kind = n.tagName === 'H1' ? 'title' : /^H[2-6]$/.test(n.tagName) ? 'head' : n.matches('.todo') ? 'upshot' : 'text';
      return { kind, text: kind === 'upshot' ? ['The upshot.', ...tldr].join(' ') : allText(n.innerHTML) };
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
