import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, clean, extract, feedArticle, feedReader, frameable, kvClient, linkShare, readArticle, run, tidy } from '../extract.mjs';
import worker, { dispatchBuild, keyFor } from '../worker.js';

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

const article = `<html><body><article><h1>T</h1><p>${'A proper sentence of the article. '.repeat(80)}</p></article></body></html>`;

async function withFetch(routes, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async u => { const r = routes[u]; if (r instanceof Error) throw r; return r ?? new Response('', { status: 404 }); };
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const read = (routes, feeds = {}) => withFetch(routes, () => readArticle({ url: 'https://x.test/a', publisher: 'P' }, feedReader(feeds)));

test('readArticle gives a reason for every outcome', async () => {
  let r = await read({ 'https://x.test/a': page(200, {}, article) });
  assert.equal(r.reason, 'ok'); assert.ok(r.content);

  r = await read({ 'https://x.test/a': page(403, {}, 'blocked') });
  assert.equal(r.reason, 'challenge'); assert.equal(r.frameable, false); assert.equal(r.content, undefined);

  r = await read({ 'https://x.test/a': page(200, {}, '<div id="__next"></div>') });
  assert.equal(r.reason, 'shell'); assert.equal(r.frameable, true);

  r = await read({ 'https://x.test/a': Object.assign(new Error('slow'), { name: 'TimeoutError' }) });
  assert.equal(r.reason, 'timeout');

  r = await read({ 'https://x.test/a': new Error('boom') });
  assert.equal(r.reason, 'error');
});

const wholeFeed = `<rss><item><link>https://x.test/a</link><content:encoded><![CDATA[<script>x()</script><p>${words(400)}</p>]]></content:encoded></item></rss>`;

test('readArticle falls back to a whole-article feed, cleaned the same way', async () => {
  const r = await read({ 'https://x.test/a': page(403, {}, 'blocked'), 'https://feed.test/rss': { ok: true, text: async () => wholeFeed } }, { P: 'https://feed.test/rss' });
  assert.equal(r.reason, 'ok'); assert.equal(r.source, 'feed');
  assert.doesNotMatch(r.content, /script/);
});

function fakeKv(initial = []) {
  const keys = new Map(initial);
  const kv = { puts: [], list: async () => new Map(keys), put: async entries => { kv.puts.push(...entries); } };
  return kv;
}

test('run skips stored articles, and stores new ones with an expiry and a word count', async () => {
  const kv = fakeKv([[await keyFor('https://x.test/done'), { reason: 'ok', words: 900 }]]);
  const items = [{ url: 'https://x.test/done', publisher: 'P' }, { url: 'https://x.test/a', publisher: 'P' }];
  const out = await withFetch({ 'https://x.test/a': page(200, {}, article) }, () => run({ items, feeds: {} }, kv));
  assert.equal(out.words['https://x.test/done'], 900);
  assert.ok(out.words['https://x.test/a'] > 400);
  assert.equal(kv.puts.length, 1);
  const [entry] = kv.puts;
  assert.equal(entry.key, await keyFor('https://x.test/a'));
  assert.equal(entry.metadata.reason, 'ok');
  assert.ok(entry.expiration_ttl > 90 * 86400);
  assert.equal(JSON.parse(entry.value).reason, 'ok');
});

test('run retries blocked stories, but only writes when something changed', async () => {
  const items = [{ url: 'https://x.test/a', publisher: 'P' }];
  const blocked = [[await keyFor('https://x.test/a'), { reason: 'challenge', words: 0 }]];
  let kv = fakeKv(blocked);
  let out = await withFetch({ 'https://x.test/a': page(403, {}, 'blocked') }, () => run({ items, feeds: {} }, kv));
  assert.equal(out.words['https://x.test/a'], 0);
  assert.equal(kv.puts.length, 0);

  kv = fakeKv(blocked);
  out = await withFetch({ 'https://x.test/a': page(200, {}, article) }, () => run({ items, feeds: {} }, kv));
  assert.equal(kv.puts[0].metadata.reason, 'ok');  // the block lifted
});

test('run redoes articles from an older version, but a block on the redo keeps what it has', async () => {
  const items = [{ url: 'https://x.test/a', publisher: 'P' }];
  const old = [[await keyFor('https://x.test/a'), { reason: 'ok', words: 300 }]];  // no version: stored before this one
  let kv = fakeKv(old);
  await withFetch({ 'https://x.test/a': page(200, {}, article) }, () => run({ items, feeds: {} }, kv));
  assert.equal(kv.puts.length, 1);
  const { v } = kv.puts[0].metadata;
  assert.ok(v);

  kv = fakeKv(old);
  const out = await withFetch({ 'https://x.test/a': page(403, {}, 'blocked') }, () => run({ items, feeds: {} }, kv));
  assert.equal(kv.puts.length, 0);
  assert.equal(out.words['https://x.test/a'], 300);

  kv = fakeKv([[old[0][0], { reason: 'ok', words: 300, v }]]);
  await withFetch({ 'https://x.test/a': new Error('should not be fetched') }, () => run({ items, feeds: {} }, kv));
  assert.equal(kv.puts.length, 0);
});

test('tidy removes furniture by what it is, and leaves the article', () => {
  const prose = 'A real sentence of the article, with enough words to count as prose. '.repeat(6);
  const content = `<div><ul><li>Kush Pandya</li></ul><p><time>Nov 6, 2026</time> <span>|</span> <span>12 min read</span></p>
    <h1>The Title</h1><h2>Table of Contents</h2><ul><li><a href="#one">One</a></li><li><a href="#two">Two</a></li></ul>
    <p>${prose}<a href="#one">a jump</a> and <a href="https://x.test/other">a real link</a>.</p><p></p>
    <p><img src="https://x.test/i.png"></p><h2 id="one">One</h2><p>${prose}</p>
    <pre>print\n12 min read\n</pre><table><tr><td>Nov 6, 2026</td></tr></table>
    <p>Share</p><h2>Related posts</h2><ul><li><a href="https://x.test/p">Another story</a></li></ul></div>`;
  const { content: out, skipped } = tidy({ content, title: 'The Title', byline: 'Kush Pandya', publishedTime: '2026-11-06T17:00:00Z' }, 'https://x.test/a');
  assert.equal(skipped, false);
  for (const gone of ['Kush Pandya', 'min read</span>', 'Table of Contents', 'href="#', 'Related posts', 'Another story', '<h1', '>Share<', 'The Title']) assert.ok(!out.includes(gone), gone);
  for (const kept of ['a jump', 'a real link', 'print', '<td>Nov 6, 2026</td>', '<figure>', '<h2 id="one"'.slice(0, 3)]) assert.ok(out.includes(kept), kept);
});

test('tidy drops a newsletter pitch and whatever follows it', () => {
  const prose = 'A real sentence of the article, with enough words to count as prose. '.repeat(6);
  const { content: out } = tidy({ content: `<div><p>${prose}</p><p>${prose}</p><h2>Subscribe to our developer newsletter</h2><p>Discover tips in our biweekly letter.</p></div>`, title: 'T' }, 'https://x.test/a');
  assert.ok(!out.includes('newsletter')); assert.ok(!out.includes('biweekly'));
});

test('tidy drops what follows the article, labelled as a heading or not', () => {
  const prose = 'A real sentence of the article, with enough words to count as prose. '.repeat(6);
  const after = [
    '<div>Keep Reading</div><p>Another story</p>', '<h2>About the Author</h2><p>A bio of them.</p>', '<h2>Written by</h2><p>A bio of them.</p>',
    '<p>Back to top</p>', '<p>89 Comments</p>', '<p>Found this article interesting? Follow us for more.</p>',
    '<p>Related: Some other story with a longer headline than chrome usually has in it at all</p>',
    '<h2>Get the latest news in your inbox</h2><p>Sign up now.</p>',
  ];
  for (const tail of after) {
    const { content: out } = tidy({ content: `<div><p>${prose}</p><p>${prose}</p>${tail}</div>`, title: 'T' }, 'https://x.test/a');
    assert.equal(out.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), `${prose}${prose}`.replace(/\s+/g, ' ').trim(), tail);
  }
  // A sentence that mentions these isn't the label.
  const { content: kept } = tidy({ content: `<div><p>${prose}</p><p>Keep reading the logs until the error stops appearing in them.</p></div>`, title: 'T' }, 'https://x.test/a');
  assert.ok(kept.includes('Keep reading the logs'));
});

test('tidy removes paid placements by their tracking codes, and only them', () => {
  const prose = 'A real sentence of the article, with enough words to count as prose. '.repeat(6);
  const ad = 'https://ads.test/lp?utm_source=x&utm_medium=paid_display&utm_campaign=y';
  const content = `<div><p>${prose}</p>
    <p><a href="https://ads.test/lp?utm_medium=display"><img src="https://x.test/banner.jpg"></a></p>
    <p>${prose} See the <a href="https://vendor.test/advisory">advisory</a> and the <a href="${ad}">sponsor</a>.</p>
    <div><p><a href="${ad}"><img src="https://x.test/ad.jpg"></a></p><div><h2><a href="${ad}">Uncover threats.</a></h2>
      <p>Their agents analyse email intent and context.</p><p><a href="${ad}">Start your free scan.</a></p></div></div>
    <p>Read the <a href="https://x.test/news?utm_medium=email">newsletter version</a> of this story.</p></div>`;
  const { content: out } = tidy({ content, title: 'T' }, 'https://x.test/a');
  for (const gone of ['banner.jpg', 'ad.jpg', 'Uncover threats', 'analyse email intent', 'free scan']) assert.ok(!out.includes(gone), gone);
  for (const kept of ['advisory', 'See the', 'newsletter version']) assert.ok(out.includes(kept), kept);  // article text, and a non-ad utm link
});

test('tidy removes banners: a lone linked image that leads off both the site and the image host', () => {
  const prose = 'A real sentence of the article, with enough words to count as prose. '.repeat(6);
  const content = `<div><p>${prose}</p>
    <div><p><a href="https://promo.example/landing"><img src="https://cdn.test/banner.jpg"></a></p></div>
    <p><a href="https://cdn.test/full.png"><img src="https://cdn.test/diagram.png"></a></p>
    <p><a href="https://x.test/author/jane"><img src="https://img.test/jane.jpg"></a></p>
    <figure><a href="https://elsewhere.test/tool"><img src="https://cdn.test/screenshot.png"></a><figcaption>The tool.</figcaption></figure>
    <p>${prose} <a href="https://elsewhere.test/source"><img src="https://cdn.test/inline.png"> with text</a></p></div>`;
  const { content: out } = tidy({ content, title: 'T' }, 'https://x.test/a');
  assert.ok(!out.includes('banner.jpg'));
  for (const kept of ['diagram.png', 'jane.jpg', 'screenshot.png', 'inline.png']) assert.ok(out.includes(kept), kept);
});

test('tidy keeps prose and real sections that only look like chrome', () => {
  const prose = 'A real sentence of the article, with enough words to count as prose. '.repeat(6);
  const content = `<div><p>${prose}</p><p>To try it, <a href="https://x.test/s">sign up for the beta</a> today.</p><h2>Related Published CVEs</h2><p>${prose}</p><p>Share this idea with the wider community of readers who care.</p></div>`;
  const { content: out } = tidy({ content, title: 'T' }, 'https://x.test/a');
  for (const kept of ['sign up for the beta', 'Related Published CVEs', 'Share this idea']) assert.ok(out.includes(kept), kept);
});

test('tidy keeps line breaks that have text between them', () => {
  const prose = 'A real sentence of the article, with enough words to count as prose. '.repeat(6);
  const { content: out } = tidy({ content: `<div><p>${prose}</p><p>one<br>two<br>three<br><br>four</p></div>`, title: 'T' }, 'https://x.test/a');
  assert.ok(out.includes('one<br>two<br>three<br>four') || out.includes('one<br>two<br>three<br/>four'));
});

test('tidy gives the article back untouched if it would remove too much', () => {
  const content = `<div><nav>${'word '.repeat(300)}</nav><p>${'A real sentence of the article. '.repeat(10)}</p></div>`;
  const r = tidy({ content, title: 'T' }, 'https://x.test/a');
  assert.equal(r.skipped, true);
  assert.equal(r.content, content);
});

test('a page that was mostly furniture is short, not an article', async () => {
  const shell = `<html><head><title>T</title></head><body><article><p>Kush Pandya</p><h2>Table of Contents</h2><nav>${'<a href="/x">A link to something</a> '.repeat(90)}</nav><p>${'Word '.repeat(95)}</p></article></body></html>`;
  const r = await read({ 'https://x.test/a': page(200, {}, shell) });
  assert.notEqual(r.reason, 'ok');
});

test('run stores nothing on a transient failure, so the next run tries again', async () => {
  const kv = fakeKv();
  const out = await withFetch({ 'https://x.test/a': new Error('boom') }, () => run({ items: [{ url: 'https://x.test/a', publisher: 'P' }], feeds: {} }, kv));
  assert.deepEqual(out.words, {});
  assert.equal(kv.puts.length, 0);
});

test('run without a store only fetches stories missing a reading time', async () => {
  const items = [{ url: 'https://x.test/done', publisher: 'P', minutes: 4 }, { url: 'https://x.test/a', publisher: 'P' }];
  const out = await withFetch({ 'https://x.test/a': page(200, {}, article) }, () => run({ items, feeds: {} }, null));
  assert.deepEqual(Object.keys(out.words), ['https://x.test/a']);
});

test('kvClient reports keys the bulk write rejected, even on a 200', async () => {
  const kv = kvClient({ CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n' });
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, result: { successful_key_count: 1, unsuccessful_keys: ['k2'] } }));
  try {
    await assert.rejects(kv.put([{ key: 'k1' }, { key: 'k2' }]), /rejected 1 of 2/);
  } finally { globalThis.fetch = real; }
  assert.equal(kvClient({}), null);
});

test('run writes at most MAX_WRITES articles a build, newest first', async () => {
  const items = Array.from({ length: 120 }, (_, n) => ({ url: `https://x.test/${n}`, publisher: 'P' }));
  const routes = Object.fromEntries(items.map(i => [i.url, page(200, {}, article)]));
  const kv = fakeKv();
  const out = await withFetch(routes, () => run({ items, feeds: {} }, kv));
  assert.equal(kv.puts.length, 100);
  assert.equal(out.deferred, 20);
  const written = new Set(kv.puts.map(e => e.key));
  assert.ok(written.has(await keyFor(items[0].url)) && !written.has(await keyFor(items[119].url)));  // newest kept
});

test('the reader function stays a lookup: no libraries, so no parsing against the CPU limit', async () => {
  const { readFileSync } = await import('node:fs');
  const code = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /^\s*import\s/m, 'worker.js imports a library; parse in extract.mjs instead');
});

test('run hands back article text for TL;DRs: fresh, from the store, and none when blocked', async () => {
  const items = [{ url: 'https://x.test/new', publisher: 'P' }, { url: 'https://x.test/old', publisher: 'P' }, { url: 'https://x.test/blocked', publisher: 'P' }];
  const oldKey = await keyFor('https://x.test/old');
  const kv = fakeKv([[oldKey, { reason: 'ok', words: 500, v: 999 }]]);
  kv.get = async key => (key === oldKey ? { reason: 'ok', content: '<p>Stored article.</p><p>Second paragraph.</p>' } : null);
  const routes = { 'https://x.test/new': page(200, {}, article), 'https://x.test/blocked': page(403, {}, 'blocked') };
  const out = await withFetch(routes, () => run({ items, feeds: {}, textFor: items.map(i => i.url) }, kv));
  assert.match(out.texts['https://x.test/new'], /A proper sentence of the article/);
  assert.equal(out.texts['https://x.test/old'], 'Stored article. Second paragraph.');
  assert.equal(out.texts['https://x.test/blocked'], undefined);
});

test('/api/read returns what the build stored, and pending otherwise', async () => {
  const url = 'https://x.test/a';
  const ask = async (env, u = url) => {
    const res = await worker.fetch(new Request('https://site.test/api/read?url=' + encodeURIComponent(u)), env);
    return [res.status, await res.json(), res.headers.get('cache-control')];
  };
  const k = await keyFor(url);
  const env = { ARTICLES: { get: async wanted => (wanted === k ? JSON.stringify({ url, reason: 'ok', frameable: false, content: '<p>x</p>' }) : null) } };
  let [status, r, cache] = await ask(env);
  assert.equal(status, 200); assert.equal(r.content, '<p>x</p>'); assert.equal(cache, 'no-store');
  [, r] = await ask(env, 'https://elsewhere.test/not-stored');
  assert.equal(r.reason, 'pending'); assert.equal(r.content, undefined);
  [, r] = await ask({});  // no binding
  assert.equal(r.reason, 'pending');
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

test('tidy keeps a lead picture wrapped in a paragraph or a link, but not the byline before it', () => {
  const prose = 'Attackers are exploiting the flaw to bypass multi-factor authentication on exposed appliances, the vendor said.';
  for (const lead of ['<p><img src="https://x.test/lead.jpg" alt="Lead"></p>', '<p><a href="https://x.test/big.jpg"><img src="https://x.test/lead.jpg" alt="Lead"></a></p>']) {
    const { content: out } = tidy({ content: `<div><p>By Ada Lovelace</p>${lead}<p>${prose}</p><p>${prose}</p></div>`, title: 'T', byline: 'Ada Lovelace' }, 'https://x.test/a');
    assert.match(out, /lead\.jpg/);
    assert.doesNotMatch(out, /Ada Lovelace/);
  }
  const avatar = '<p><a href="/ada"><img src="https://x.test/ada.png" width="32" height="32" alt="Ada"></a></p>';
  assert.doesNotMatch(tidy({ content: `<div>${avatar}<p>${prose}</p><p>${prose}</p></div>`, title: 'T' }, 'https://x.test/a').content, /ada\.png/);
});


test('pages get a fresh CSP nonce for Cloudflare\'s injected script; files and the reader are untouched', async () => {
  const CSP = "default-src 'self'; script-src 'self' 'sha256-abc='; object-src 'none'";
  const ASSETS = { fetch: async req => new URL(req.url).pathname.endsWith('.json')
    ? new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Security-Policy': CSP } })
    : new Response('<p>page</p>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP } }) };
  const get = path => worker.fetch(new Request('https://site.test' + path), { ASSETS });
  const [a, b] = [await get('/'), await get('/')];
  const nonceOf = res => res.headers.get('Content-Security-Policy').match(/script-src 'nonce-([^']+)' 'self' 'sha256-abc='/)?.[1];
  assert.ok(nonceOf(a) && nonceOf(b) && nonceOf(a) !== nonceOf(b));  // the hashes stay, and each response gets its own
  assert.equal(await a.text(), '<p>page</p>');
  assert.equal((await get('/data.json')).headers.get('Content-Security-Policy'), CSP);
  assert.equal((await (await get('/api/read?url=x')).json()).reason, 'pending');
});

test('the cron dispatches the Build workflow on main, skips without a token, and throws on a refusal', async () => {
  const real = globalThis.fetch, calls = [];
  let status = 204;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(status === 204 ? null : 'nope', { status }); };
  try {
    await worker.scheduled({}, {});
    assert.equal(calls.length, 0);
    const env = { GITHUB_DISPATCH_TOKEN: 't0k', BUILD_REPO: 'me/upshot' };
    await worker.scheduled({}, env);
    assert.equal(calls[0].url, 'https://api.github.com/repos/me/upshot/actions/workflows/build.yml/dispatches');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer t0k');
    assert.ok(calls[0].init.headers['User-Agent']);
    assert.deepEqual(JSON.parse(calls[0].init.body), { ref: 'main' });
    status = 401;
    await assert.rejects(dispatchBuild(env), /401/);
  } finally { globalThis.fetch = real; }
});

test('the licensed fonts come from R2, only as .woff2, and only to the site and its reader frame', async () => {
  const asked = [];
  const env = { FONTS: { get: async key => (asked.push(key), key === 'Mercury-TextG2Roman.woff2' ? { body: 'FONT', httpEtag: '"e1"' } : null) } };
  const get = path => worker.fetch(new Request('https://site.test' + path), env);
  const res = await get('/fonts/mercury/Mercury-TextG2Roman');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'FONT');
  assert.equal(res.headers.get('content-type'), 'font/woff2');
  assert.equal(res.headers.get('etag'), '"e1"');
  assert.equal(res.headers.get('access-control-allow-origin'), 'null');  // the sandboxed frame, not every site
  assert.match(res.headers.get('cache-control'), /max-age=604800/);
  assert.equal((await get('/fonts/mercury/Missing')).status, 404);
  assert.deepEqual(asked, ['Mercury-TextG2Roman.woff2', 'Missing.woff2']);  // nothing but .woff2 can be read from the bucket
  const unbound = await worker.fetch(new Request('https://site.test/fonts/mercury/Mercury-TextG2Roman'), {});
  assert.equal(unbound.status, 404);  // a fork without the bucket: the reader falls back to the system serif
});
