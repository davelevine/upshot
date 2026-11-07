// Reader view: fetches one article that's on the site and returns its main content.
// Nothing is stored or cached, and only articles listed on the site are fetched.
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MAX_HTML = 3_000_000;
const MIN_TEXT = 500; // shorter "articles" are usually cookie walls or app shells
const MIN_FEED_WORDS = 300; // less is a teaser, not the article
const MIN_PAGE_WORDS = 300; // a page with less visible text than this is a shell, not an article that didn't parse
const MAX_LINK_SHARE = 0.5; // more of an "article" than this is links: it's a list of other stories
const PAGE_TIMEOUT = 15000; // some pages take 10s from here, and the reader's card means nobody's staring at nothing
const FEED_TIMEOUT = 10000; // one full-article feed is 4MB
const CHALLENGE = /cf-challenge|_cf_chl_opt|Just a moment|Access Denied|Request unsuccessful|Incapsula/i; // about bot-protection vendors, not publishers
const DROP = 'script, style, noscript, iframe, object, embed, form, input, button, link, meta, svg';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

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
  if (CHALLENGE.test(html) && visibleWords(html) < MIN_PAGE_WORDS) return 'challenge';  // the cheap test first: this runs on every page
  return null;
}

// One article's text from a feed that publishes whole articles, or null. It's fetched live, like the page, so nothing is stored.
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
export function linkShare(html) {  // by regex, not a parse: this runs on every article, against Cloudflare's CPU limit
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

async function fromFeed(env, request, item) {
  try {
    const feeds = await (await env.ASSETS.fetch(new URL('/feeds.json', request.url))).json();
    const feed = feeds[item.publisher];  // only feeds the build found publishing whole articles
    if (!feed) return null;
    const res = await fetch(feed, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FEED_TIMEOUT) });
    return res.ok ? feedArticle(await res.text(), item.url) : null;
  } catch { return null; }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url).searchParams.get('url');
  // Only articles that are on the site, so this can't be used as an open proxy.
  const data = await (await env.ASSETS.fetch(new URL('/data.json', request.url))).json();
  const item = url && data.items.find(i => i.url === url);
  if (!item) return json({ error: 'not an Upshot article' }, 404);

  const result = { url, frameable: false, reason: 'error' };
  let base = url;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(PAGE_TIMEOUT) });
    base = res.url || url;
    const html = (await res.text()).slice(0, MAX_HTML);
    const blocked = classify(res, html);
    if (blocked) result.reason = blocked;
    else {
      const article = extract(html);
      if (article) {
        return json({ url, frameable: false, reason: 'ok', title: article.title, byline: article.byline, siteName: article.siteName, content: clean(article.content, base) });
      }
      // The page loaded but has no article we can pull out, so showing the original is the only thing that can help.
      result.reason = visibleWords(html) < MIN_PAGE_WORDS ? 'shell' : 'short';
      result.frameable = frameable(res.headers);
    }
  } catch (e) {
    result.reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'error';
  }
  const fromRss = await fromFeed(env, request, item);
  if (fromRss) return json({ url, frameable: false, reason: 'ok', source: 'feed', content: clean(fromRss, url) });
  return json(result);
}
