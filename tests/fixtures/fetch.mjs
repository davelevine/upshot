// Run by hand, never in CI: node tests/fixtures/fetch.mjs [Publisher ...]
// Saves one page per feed, with its article text scrambled so no publisher's writing is committed. Structure, links and
// short chrome ("12 min read", "Share") stay real, because those are what the reader's cleanup has to recognise.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { classify } from '../../extract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MIN_SCRAMBLE_WORDS = 3; // shorter is a name or a label, which is structure rather than writing
// What the reader's cleanup has to recognise, so it stays real. It's what page furniture says, not what any article does.
const CHROME = /^\s*(\d+ min(ute)?s?( read)?|share( this( article| post| story)?)?:?|tweet|copy link|print|(table of )?contents|on this page|in this (article|post)|jump to|related( posts?| articles?| stories)?:?|read next|you may also like|advertisement|sponsored|tags?:|topics?:|filed under:?|categories:?|subscribe( to .*)?|sign up( for .*)?|newsletter|keep reading|back to top|about the authors?|written by|\d+ comments?|found this article interesting.*|show more\s*show less|posted on .+\d+ comments?|related: .*|get .+ in your inbox|[|•·—–-]+|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4})\s*$/i;
const LETTERS = 'etaoinshrdlucmfwypvbgk';

export const slug = publisher => publisher.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Same text gives the same result, so a title still equals its heading; the same word elsewhere doesn't, so it can't be decoded.
const scrambleWords = (text, seed) => {
  let n = 0;
  return text.replace(/\p{L}+|\p{N}+/gu, word => {
    const bytes = createHash('sha256').update(`${seed}\0${n++}`).digest();
    return [...word].map((c, k) => {
      const b = bytes[k % bytes.length] + k;
      if (/\p{N}/u.test(c)) return String(b % 10);
      const out = LETTERS[b % LETTERS.length];
      return c === c.toUpperCase() && c !== c.toLowerCase() ? out.toUpperCase() : out;
    }).join('');
  });
};
const seedOf = text => text.trim().replace(/\s+/g, ' ').toLowerCase();
const isLong = text => text.trim().split(/\s+/).length >= MIN_SCRAMBLE_WORDS;
export const scramble = text => (isLong(text) && !CHROME.test(text) ? scrambleWords(text, seedOf(text)) : text);
const scrambleTitle = t => t.split(/(\s+[|\-–—:»·]+\s+)/).map(part => scramble(part)).join('');

const BLOCK = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BODY|DD|DETAILS|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|HTML|LI|MAIN|NAV|OL|P|PRE|SECTION|SUMMARY|TABLE|TBODY|TD|TFOOT|TH|THEAD|TR|UL|HEAD)$/;
const WHOLE = /^(PRE|TABLE|UL|OL|DL)$/;
const textNodes = (node, out = []) => {
  if (node.nodeType === 3) out.push(node);
  else if (node.nodeType === 1) for (const c of node.childNodes) textNodes(c, out);
  return out;
};
const hasBlock = el => BLOCK.test(el.tagName) || [...el.children].some(hasBlock);

// A line of text is judged whole: prose broken up by links and bold is still prose, even if each piece is short.
function scrambleRun(nodes) {
  const texts = nodes.flatMap(n => textNodes(n));
  const whole = texts.map(t => t.textContent).join(' ');
  if (!isLong(whole) || CHROME.test(whole)) return;
  const seed = seedOf(whole);
  texts.forEach((t, k) => { if (!CHROME.test(t.textContent)) t.textContent = scrambleWords(t.textContent, k ? `${seed}\0${k}` : seed); });
}

function walk(el) {
  // A run of short lines, like code with a div per line, is one piece of content.
  const kids = [...el.children];
  if (kids.length >= 3 && kids.every(k => !k.children.length || !hasBlock(k)) && kids.every(k => !isLong(k.textContent || ''))) { scrambleRun([el]); return; }
  let run = [];
  const flush = () => { if (run.length) scrambleRun(run); run = []; };
  for (const child of [...el.childNodes]) {
    if (child.nodeType === 8) { child.remove(); continue; }
    if (child.nodeType === 1 && child.tagName === 'TITLE') continue;
    if (child.nodeType === 1 && WHOLE.test(child.tagName)) { flush(); scrambleRun([child]); }  // short lines, but real content together
    else if (child.nodeType === 1 && hasBlock(child)) { flush(); walk(child); } else if (child.nodeType === 1 || child.nodeType === 3) run.push(child);
  }
  flush();
}

export function scramblePage(html) {
  const { document } = parseHTML(html);
  document.querySelectorAll('script, style, noscript, svg, template, link[rel="stylesheet"], link[rel="preload"]').forEach(el => el.remove());
  walk(document.documentElement);
  const title = document.querySelector('title');
  if (title) title.textContent = scrambleTitle(title.textContent);
  for (const el of document.querySelectorAll('[alt], [title], [aria-label], [content], [srcset], [style]')) {
    for (const a of ['alt', 'title', 'aria-label']) if (el.hasAttribute(a)) el.setAttribute(a, scramble(el.getAttribute(a)));
    if (el.hasAttribute('content')) {
      const key = el.getAttribute('property') || el.getAttribute('name') || '';
      el.setAttribute('content', /title/i.test(key) ? scrambleTitle(el.getAttribute('content')) : scramble(el.getAttribute('content')));
    }
    el.removeAttribute('srcset'); el.removeAttribute('style');
  }
  return `<!doctype html>\n${document.documentElement.outerHTML}\n`;
}

const firstLink = xml => {
  const entry = xml.split(/<(?:item|entry)[\s>]/)[1] || '';
  const m = /<link(?:\s[^>]*?href=["']([^"']+)["'][^>]*\/?>|[^>]*>(?:<!\[CDATA\[)?([^<\]]+))/.exec(entry);
  return (m?.[1] || m?.[2] || '').trim().replace(/&amp;/g, '&');
};

async function articleFor(publisher, feed, items) {
  const known = items.find(i => i.publisher === publisher);
  if (known) return known.url;
  const r = await fetch(feed, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  return firstLink(await r.text());
}

async function main() {
  const only = process.argv.slice(2);
  const rawDir = process.env.RAW_DIR;  // real pages, for working on the rules; keep this outside the repository
  const items = JSON.parse(readFileSync(join(ROOT, 'site/data.json'), 'utf8')).items;
  const opml = readFileSync(join(ROOT, 'feeds.opml'), 'utf8');
  const feeds = [...opml.matchAll(/<outline[^>]*\stext="([^"]+)"[^>]*\sxmlUrl="([^"]+)"/g)].map(m => [m[1].replace(/&amp;/g, '&'), m[2].replace(/&amp;/g, '&')]);
  const pages = join(HERE, 'pages');
  mkdirSync(pages, { recursive: true });
  const metaPath = join(HERE, 'meta.json');
  let meta = {};
  try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch {}
  const queue = feeds.filter(([p]) => !only.length || only.includes(p));
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const [publisher, feed] = queue.shift();
      try {
        const url = await articleFor(publisher, feed, items);
        if (!url) throw new Error('no article in feed');
        const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(20000) });
        const html = (await res.text()).slice(0, 3_000_000);
        if (rawDir) { mkdirSync(rawDir, { recursive: true }); writeFileSync(join(rawDir, `${slug(publisher)}.html`), html); }
        const blocked = classify(res, html);
        // A block page holds no article, and its scripts are what identify it, so it's kept as it came.
        writeFileSync(join(pages, `${slug(publisher)}.html`), blocked ? html.slice(0, 30000) : scramblePage(html));
        meta[publisher] = { file: `${slug(publisher)}.html`, url: res.url || url, status: res.status, contentType: res.headers.get('content-type'), mitigated: res.headers.get('cf-mitigated') };
        console.log(res.status, publisher);
      } catch (e) { console.log('FAILED', publisher, e.message); }
    }
  }));
  writeFileSync(metaPath, JSON.stringify(Object.fromEntries(Object.entries(meta).sort()), null, 1) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
