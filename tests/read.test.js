import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, clean, extract, feedArticle, frameable, linkShare, onRequestGet } from '../functions/api/read.js';

test('frameable honours X-Frame-Options and frame-ancestors', () => {
  const h = o => new Headers(o);
  assert.equal(frameable(h({})), true);
  assert.equal(frameable(h({ 'X-Frame-Options': 'DENY' })), false);
  assert.equal(frameable(h({ 'X-Frame-Options': 'SAMEORIGIN' })), false);
  assert.equal(frameable(h({ 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'" })), false);
  assert.equal(frameable(h({ 'Content-Security-Policy': 'frame-ancestors *' })), true);
});

test('clean strips active content and makes links absolute', () => {
  const out = clean(`<p onclick="x()" style="color:red">Hi<script>alert(1)</script></p>
    <a href="javascript:alert(1)">bad</a><a href="/post">rel</a><img data-src="i.png"><iframe src="https://x"></iframe><span></span>`,
    'https://example.com/a/');
  assert.doesNotMatch(out, /script|onclick|style=|javascript:|iframe|/);
  const link = /<a[^>]*href="https:\/\/example.com\/post"[^>]*>/.exec(out)?.[0] ?? '';
  assert.match(link, /target="_blank"/);
  assert.match(link, /rel="noopener noreferrer"/);
  assert.match(out, /<img[^>]+src="https:\/\/example.com\/a\/i.png"/);
});

test('clean keeps adjacent metadata spans apart, but not code tokens', () => {
  const out = clean('<p><span><span>Nov 04, 2026</span></span><span>Cloud Security</span></p><pre><span>a</span><span>b</span></pre>', 'https://x.test/');
  assert.match(out, /2026<\/span><\/span> <span>Cloud/);
  assert.match(out, /<span>a<\/span><span>b<\/span>/);
});

const page = (status, headers, body = '') => ({ status, ok: status >= 200 && status < 300, url: 'https://x.test/a', headers: new Headers({ 'content-type': 'text/html', ...headers }), text: async () => body });
const words = n => 'word '.repeat(n);

test('classify recognises blocks by status and header, not by what an article says', () => {
  assert.equal(classify(page(403, {}), ''), 'challenge');
  assert.equal(classify(page(202, {}), ''), 'challenge');
  assert.equal(classify(page(200, { 'cf-mitigated': 'challenge' }), ''), 'challenge');
  assert.equal(classify(page(500, {}), ''), 'error');
  assert.equal(classify(page(200, { 'content-type': 'application/pdf' }), ''), 'not_html');
  assert.equal(classify(page(200, {}), '<p>Just a moment...</p>'), 'challenge');
  // A long article that discusses these things is an article.
  assert.equal(classify(page(200, {}), `<p>Access Denied and CAPTCHA bypass. ${words(800)}</p>`), null);
});

test('feedArticle finds an entry by its own link and ignores teasers', () => {
  const body = `<p>${words(400)}</p>`;
  const rss = `<rss><channel><item><title>Newer</title><link>https://x.test/newer?source=rss</link>
      <content:encoded><![CDATA[<a href="https://x.test/older">the older post</a><p>${'newer '.repeat(400)}</p>]]></content:encoded></item>
    <item><link>https://x.test/older?source=rss</link><content:encoded><![CDATA[${body}]]></content:encoded></item>
    <item><link>https://x.test/teaser</link><description>Just a teaser.</description></item></channel></rss>`;
  assert.equal(feedArticle(rss, 'https://x.test/older'), body);  // not the newer post that links to it
  assert.equal(feedArticle(rss, 'https://x.test/teaser'), null);
  assert.equal(feedArticle(rss, 'https://x.test/missing'), null);
  const atom = `<feed><entry><link rel="alternate" href="https://x.test/atom"/><content type="html">&lt;p&gt;${words(400)}&lt;/p&gt;</content></entry></feed>`;
  assert.match(feedArticle(atom, 'https://x.test/atom'), /^<p>word/);
});

async function read(routes, feeds = {}, url = 'https://x.test/a') {
  const real = globalThis.fetch;
  globalThis.fetch = async u => { const r = routes[u]; if (r instanceof Error) throw r; return r; };
  const assets = { '/data.json': { items: [{ url: 'https://x.test/a', publisher: 'P' }] }, '/feeds.json': feeds };
  const env = { ASSETS: { fetch: async u => new Response(JSON.stringify(assets[new URL(u).pathname])) } };
  try {
    const res = await onRequestGet({ request: new Request('https://site.test/api/read?url=' + encodeURIComponent(url)), env });
    return [res.status, await res.json(), res.headers.get('cache-control')];
  } finally { globalThis.fetch = real; }
}

test('/api/read gives a reason for every outcome', async () => {
  const article = `<html><body><article><h1>T</h1><p>${'A proper sentence of the article. '.repeat(80)}</p></article></body></html>`;
  let [status, r, cache] = await read({ 'https://x.test/a': page(200, {}, article) });
  assert.equal(status, 200); assert.equal(r.reason, 'ok'); assert.ok(r.content); assert.equal(cache, 'no-store');

  [, r] = await read({ 'https://x.test/a': page(403, {}, 'blocked') });
  assert.equal(r.reason, 'challenge'); assert.equal(r.frameable, false); assert.equal(r.content, undefined);

  [, r] = await read({ 'https://x.test/a': page(200, {}, '<div id="__next"></div>') });
  assert.equal(r.reason, 'shell'); assert.equal(r.frameable, true);

  [, r] = await read({ 'https://x.test/a': Object.assign(new Error('slow'), { name: 'TimeoutError' }) });
  assert.equal(r.reason, 'timeout');

  [, r] = await read({ 'https://x.test/a': new Error('boom') });
  assert.equal(r.reason, 'error');

  [status] = await read({}, {}, 'https://elsewhere.test/not-on-the-site');
  assert.equal(status, 404);  // never an open proxy
});

test('/api/read falls back to a whole-article feed, cleaned the same way', async () => {
  const feed = `<rss><item><link>https://x.test/a</link><content:encoded><![CDATA[<script>x()</script><p>${words(400)}</p>]]></content:encoded></item></rss>`;
  const routes = { 'https://x.test/a': page(403, {}, 'blocked'), 'https://feed.test/rss': { ok: true, text: async () => feed } };
  const [, r] = await read(routes, { P: 'https://feed.test/rss' });
  assert.equal(r.reason, 'ok'); assert.equal(r.source, 'feed');
  assert.doesNotMatch(r.content, /script/);
});

test('linkShare tells prose from a list of links', () => {
  assert.equal(linkShare('<ul><li><a href="/a">Another story</a></li></ul>'), 1);
  assert.ok(linkShare(`<p>${words(100)}<a href="/a">a link</a></p>`) < 0.1);
});

test('extract keeps the story when a related-posts list outscores it', () => {
  const related = n => `<ul>${Array.from({ length: n }, (_, k) => `<li><a href="/p${k}"><p>Related story number ${k}, with a description long enough, to score well, and commas, for Readability.</p><span>Read now</span></a></li>`).join('')}</ul>`;
  const story = '<div><p>The real story begins here, in a plain paragraph of prose.</p>' + `<p>${'A sentence of the actual article, with some commas, like this. '.repeat(40)}</p>`.repeat(4) + '</div>';
  const a = extract(`<html><head><title>T</title></head><body>${related(40)}${story}${related(40)}</body></html>`);
  assert.match(a.textContent, /The real story begins here/);
  assert.doesNotMatch(a.textContent, /Read now/);
});

test('extract leaves alone a short post with a few links, and gives up on a page of only links', () => {
  const post = `<article><p>${'A short post, but a real one, with a sentence or two. '.repeat(14)}<a href="/x">one link</a></p></article>`;
  assert.match(extract(`<html><head><title>T</title></head><body>${post}</body></html>`).textContent, /one link/);
  const only = `<div>${Array.from({ length: 30 }, (_, k) => `<p><a href="/p${k}">A link to another story, number ${k}, in a long list of them.</a></p>`).join('')}</div>`;
  assert.equal(extract(`<html><head><title>T</title></head><body>${only}</body></html>`), null);
});
