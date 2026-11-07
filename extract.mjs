// Pulls each story's article during the build and stores it in Cloudflare KV, where /api/read serves it from.
// Parsing happens here because it costs far more CPU than a Pages Function is allowed per request.
// stdin: {items: [{url, publisher, minutes}], feeds: {publisher: url}}. stdout: {words: {url: n}, error}.
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { keyFor } from './functions/api/read.js';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MAX_HTML = 3_000_000;
const MIN_TEXT = 500; // shorter "articles" are usually cookie walls or app shells
const MIN_FEED_WORDS = 300; // less is a teaser, not the article
const MIN_PAGE_WORDS = 300; // a page with less visible text than this is a shell, not an article that didn't parse
const MAX_LINK_SHARE = 0.5; // more of an "article" than this is links: it's a list of other stories
const PAGE_TIMEOUT = 15000; // some pages take 10s
const FEED_TIMEOUT = 10000; // one full-article feed is 4MB
const CONCURRENCY = 6;
const TTL = 100 * 86400; // past the build's KEEP_DAYS (90), so expired articles are already off the site
const TRANSIENT = ['timeout', 'error']; // not a verdict on the article: try again next run
const CHALLENGE = /cf-challenge|_cf_chl_opt|Just a moment|Access Denied|Request unsuccessful|Incapsula/i; // about bot-protection vendors, not publishers
const DROP = 'script, style, noscript, iframe, object, embed, form, input, button, link, meta, svg';

// Whether the site lets itself be shown in a frame on another origin.
export function frameable(headers) {
  const xfo = (headers.get('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return false;
  const fa = /frame-ancestors([^;]*)/i.exec(headers.get('content-security-policy') || '');
  return !fa || fa[1].includes('*');
}

// Strips anything active and makes every link and image absolute.
export function clean(html, base) {
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${html}</div></body></html>`);
  const root = document.getElementById('root');
  root.querySelectorAll(DROP).forEach(el => el.remove());
  for (const el of root.querySelectorAll('*')) {
    for (const { name } of [...el.attributes]) {
      if (name.startsWith('on') || name === 'style' || name === 'srcset') el.removeAttribute(name);
    }
    for (const attr of ['href', 'src']) {
      const v = el.getAttribute(attr);
      if (v == null) continue;
      try {
        const abs = new URL(v, base);
        if (abs.protocol === 'http:' || abs.protocol === 'https:') el.setAttribute(attr, abs.href);
        else el.removeAttribute(attr);
      } catch { el.removeAttribute(attr); }
    }
    if (el.tagName === 'IMG') {
      const lazy = el.getAttribute('data-src') || el.getAttribute('data-lazy-src');
      if (!el.getAttribute('src') && lazy) try { el.setAttribute('src', new URL(lazy, base).href); } catch {}
      el.setAttribute('loading', 'lazy');
    }
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
  }
  // Sites space out metadata spans with CSS ("Nov 04, 2026" + "Cloud Security"); without it the text runs together.
  for (const el of root.querySelectorAll('span, time, a')) {
    const next = el.nextSibling;
    if (next?.nodeType === 1 && !el.closest('pre, code') && /\S$/.test(el.textContent) && /^\S/.test(next.textContent)) {
      el.parentNode.insertBefore(document.createTextNode(' '), next);
    }
  }
  return root.innerHTML.replace(/[\uE000-\uF8FF]/g, ' ');  // icon-font glyphs (boxes without the site's fonts) often separate words
}

const wordCount = text => text.split(/\s+/).filter(Boolean).length;
const visibleWords = html => wordCount(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '));

// Why a response can't be read, before trying to extract it. Null means it's worth extracting. Challenge words are only
// believed on a nearly empty page, because real articles say "access denied" and "CAPTCHA" too.
export function classify(res, html) {
  if (res.headers.get('cf-mitigated') === 'challenge' || [202, 401, 403, 429, 503].includes(res.status)) return 'challenge';
  if (!res.ok) return 'error';
  if (!(res.headers.get('content-type') || '').includes('html')) return 'not_html';
  if (CHALLENGE.test(html) && visibleWords(html) < MIN_PAGE_WORDS) return 'challenge';
  return null;
}

// One article's text from a feed that publishes whole articles, or null.
export function feedArticle(xml, url) {
  const { pathname } = new URL(url);
  const pathOf = link => { try { return new URL(link.trim().replace(/&amp;/g, '&')).pathname; } catch { return null; } };
  // Its own link, not just a mention: a newer post that links to this one mustn't be served in its place.
  const entry = xml.split(/<(?:item|entry)[\s>]/).slice(1).find(e => [...e.matchAll(/<link(?:\s[^>]*?href=["']([^"']+)["'][^>]*\/?>|[^>]*>(?:<!\[CDATA\[)?([^<\]]+))/g)]
    .some(m => pathOf(m[1] || m[2]) === pathname));
  if (!entry) return null;
  const bodies = [/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/, /<content(?:\s[^>]*)?>([\s\S]*?)<\/content>/, /<description[^>]*>([\s\S]*?)<\/description>/]
    .map(re => re.exec(entry)?.[1]).filter(Boolean)
    .map(b => /^\s*<!\[CDATA\[/.test(b) ? b.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '')
      : b.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&'));
  const best = bodies.sort((a, b) => visibleWords(b) - visibleWords(a))[0];
  return best && visibleWords(best) >= MIN_FEED_WORDS ? best : null;
}

// How much of a piece of HTML is link text. An article is prose; a list of related posts is nearly all links.
export function linkShare(html) {
  const textLength = h => h.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length;
  const total = textLength(html);
  if (!total) return 1;
  let links = 0;
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) links += textLength(m[1]);
  return links / total;
}

const parseArticle = html => new Readability(parseHTML(html).document).parse();
const usable = a => a?.content && (a.textContent || '').trim().length >= MIN_TEXT && linkShare(a.content) < MAX_LINK_SHARE;

// The article in a page, or null. Readability sometimes scores a "related posts" list above the story, so if what it
// found is mostly links, take the page's link-heavy lists out and try once more.
export function extract(html) {
  const article = parseArticle(html);
  if (usable(article)) return article;
  const { document } = parseHTML(html);
  for (const list of [...document.querySelectorAll('ul, ol')]) {
    if (list.querySelector('a') && linkShare(list.innerHTML) >= MAX_LINK_SHARE) list.remove();
  }
  const retry = new Readability(document).parse();
  return usable(retry) ? retry : null;
}

// What the reader gets for one story: its article, or the reason there isn't one.
export async function readArticle(item, feedText) {
  const { url } = item;
  const result = { url, frameable: false, reason: 'error' };
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(PAGE_TIMEOUT) });
    const html = (await res.text()).slice(0, MAX_HTML);
    const blocked = classify(res, html);
    if (blocked) result.reason = blocked;
    else {
      const article = extract(html);
      if (article) return { url, frameable: false, reason: 'ok', title: article.title, byline: article.byline, siteName: article.siteName, content: clean(article.content, res.url || url) };
      // The page loaded but has no article to pull out, so showing the original is the only thing that can help.
      result.reason = visibleWords(html) < MIN_PAGE_WORDS ? 'shell' : 'short';
      result.frameable = frameable(res.headers);
    }
  } catch (e) {
    result.reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'error';
  }
  const body = feedArticle(await feedText(item.publisher), url);
  return body ? { url, frameable: false, reason: 'ok', source: 'feed', content: clean(body, url) } : result;
}

// Each feed once per run, and '' if there isn't one or it fails.
export function feedReader(feeds) {
  const seen = new Map();
  return publisher => {
    if (!feeds[publisher]) return Promise.resolve('');
    if (!seen.has(publisher)) {
      seen.set(publisher, fetch(feeds[publisher], { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FEED_TIMEOUT) })
        .then(r => (r.ok ? r.text() : '')).catch(() => ''));
    }
    return seen.get(publisher);
  };
}

export function kvClient({ CF_API_TOKEN, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID }) {
  if (!CF_API_TOKEN || !CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID) return null;
  const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}`;
  const call = async (path, init = {}) => {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {  // Cloudflare's API has the odd bad moment; a failed build costs a whole run
      try {
        const res = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' } });
        if (res.ok) return await res.json();
        last = `KV ${res.status}`;
      } catch (e) { last = `KV ${e.message}`; }
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
    throw new Error(last);
  };
  return {
    async list() {
      const keys = new Map();
      let cursor = '';
      do {
        const page = await call(`/keys?limit=1000${cursor && `&cursor=${encodeURIComponent(cursor)}`}`);
        for (const k of page.result) keys.set(k.name, k.metadata || {});
        cursor = page.result_info?.cursor;
      } while (cursor);
      return keys;
    },
    put: entries => call('/bulk', { method: 'PUT', body: JSON.stringify(entries) }),
  };
}

// Stores what's new or was blocked last time, and reports every story's word count. 0 means blocked; no entry means try again.
export async function run({ items, feeds }, kv) {
  const stored = kv ? await kv.list() : new Map();
  const keys = new Map(await Promise.all(items.map(async i => [i.url, await keyFor(i.url)])));
  const words = {}, entries = [], counts = {}, feedText = feedReader(feeds);
  const todo = items.filter(i => {
    const had = stored.get(keys.get(i.url));
    if (had?.reason === 'ok') { words[i.url] = had.words; return false; }
    return kv || !i.minutes;  // with nowhere to store it, only a missing reading time is worth a fetch
  });
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const record = await readArticle(item, feedText);
      counts[record.reason] = (counts[record.reason] || 0) + 1;
      if (TRANSIENT.includes(record.reason)) continue;
      const n = record.content ? visibleWords(record.content) : 0;
      words[item.url] = n;
      const key = keys.get(item.url);
      if (stored.get(key)?.reason === record.reason) continue;  // still blocked the same way: nothing to write
      entries.push({ key, value: JSON.stringify(record), expiration_ttl: TTL, metadata: { reason: record.reason, words: n } });
    }
  }));
  if (kv && entries.length) await kv.put(entries);
  return { words, counts, stored: kv ? entries.length : 0, total: stored.size };
}

async function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const kv = kvClient(process.env);
  if (!kv) console.error('::warning::no KV credentials: the reader has nothing to serve');
  let out = { words: {} };
  try {
    const { words, counts, stored, total } = await run(input, kv);
    out = { words };
    const line = `**Reader:** ${stored} articles written, ${total} already in KV, this run ${JSON.stringify(counts)}`;
    console.error(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n\n`);
  } catch (e) {
    out.error = e.message;
  }
  process.stdout.write(JSON.stringify(out));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
