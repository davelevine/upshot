// Runs the whole reader pipeline over one saved page per feed: the proof that the rules are general, not per-site.
// A feed isn't added until it has a page here. To add one: node tests/fixtures/fetch.mjs "Publisher", then
// UPDATE_EXPECTED=1 node --test tests/fixtures.test.js, and read the diff of expected.json before committing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { feedReader, readArticle, tidy, extract } from '../extract.mjs';
import { scramble, scramblePage } from './fixtures/fetch.mjs';

const DIR = new URL('./fixtures/', import.meta.url).pathname;
const read = name => readFileSync(join(DIR, name), 'utf8');
const META = JSON.parse(read('meta.json'));
const EXPECTED = existsSync(join(DIR, 'expected.json')) ? JSON.parse(read('expected.json')) : {};
const FEEDS = [...read('../../feeds.opml').matchAll(/<outline[^>]*\stext="([^"]+)"[^>]*\sxmlUrl="([^"]+)"/g)].map(m => [m[1].replace(/&amp;/g, '&'), m[2].replace(/&amp;/g, '&')]);
const CHROME = /^(\d+ min(ute)?s?( read)?|(share|tweet|copy link)( this( article| post| story)?)?:?|table of contents|related posts|advertisement|sponsored)$/i;
const TOLERANCE = 0.1;

async function pipeline(meta) {
  const html = read(`pages/${meta.file}`);
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(html, { status: meta.status, headers: { 'content-type': meta.contentType || '', ...(meta.mitigated && { 'cf-mitigated': meta.mitigated }) } });
  try { return await readArticle({ url: meta.url, publisher: '' }, feedReader({})); } finally { globalThis.fetch = real; }
}
const words = text => text.split(/\s+/).filter(Boolean).length;
const bodyOf = html => parseHTML(`<!doctype html><html><body><div id="r">${html}</div></body></html>`).document.getElementById('r');

test('every feed has a saved page and an expected result', () => {
  for (const [publisher] of FEEDS) {
    assert.ok(META[publisher], `${publisher}: no fixture. Run node tests/fixtures/fetch.mjs "${publisher}"`);
    assert.ok(existsSync(join(DIR, 'pages', META[publisher].file)), `${publisher}: page missing`);
    assert.ok(EXPECTED[publisher] || process.env.UPDATE_EXPECTED, `${publisher}: not in expected.json`);
  }
});

test('the reader pipeline holds on every publisher', async () => {
  const report = [], out = {};
  for (const [publisher, meta] of Object.entries(META)) {
    const r = await pipeline(meta);
    const root = r.content ? bodyOf(r.content) : null;
    const text = root ? root.textContent.replace(/\s+/g, ' ').trim() : '';
    const got = { reason: r.reason, words: words(text), start: text.slice(0, 60) };
    out[publisher] = { ...got, ...(EXPECTED[publisher]?.note && { note: EXPECTED[publisher].note }) };
    if (process.env.UPDATE_EXPECTED) continue;
    const want = EXPECTED[publisher];
    assert.ok(want, `${publisher}: not in expected.json`);
    assert.equal(got.reason, want.reason, `${publisher}: reason`);
    if (r.reason !== 'ok') continue;

    assert.ok(Math.abs(got.words - want.words) <= Math.max(10, want.words * TOLERANCE), `${publisher}: ${got.words} words, expected about ${want.words}`);
    assert.equal(got.start, want.start, `${publisher}: the article should start here`);
    assert.equal(root.querySelectorAll('a[href^="#"]').length, 0, `${publisher}: same-page link`);
    assert.equal(root.querySelectorAll('h1').length, 0, `${publisher}: h1 in the body`);
    const first = root.querySelector('h2, h3, h4, h5, h6');
    if (first && r.title) assert.notEqual(first.textContent.trim().toLowerCase(), r.title.trim().toLowerCase(), `${publisher}: title repeated`);
    for (const el of root.querySelectorAll('p, div, li, h2, h3, h4, h5, h6, span, time')) {
      if (el.closest('pre, code, table')) continue;
      assert.doesNotMatch(el.textContent.trim(), CHROME, `${publisher}: chrome left in`);
    }
    const article = extract(read(`pages/${meta.file}`));
    if (article) {
      const { loss, skipped } = tidy(article, meta.url);
      assert.equal(skipped, false, `${publisher}: tidy hit its guardrail`);
      assert.ok(loss < 0.35, `${publisher}: tidy removed ${Math.round(loss * 100)}%`);
      report.push([Math.round(loss * 1000) / 10, publisher]);
    }
  }
  if (process.env.UPDATE_EXPECTED) writeFileSync(join(DIR, 'expected.json'), JSON.stringify(out, null, 1) + '\n');
  else console.log(report.sort((a, b) => b[0] - a[0]).slice(0, 8).map(([p, n]) => `${p}% ${n}`).join(', '));  // so a creep is visible
});

test('no publisher is named in the reader code', () => {
  const hosts = new Set(FEEDS.map(([, url]) => new URL(url).hostname.replace(/^www\./, '')));
  for (const meta of Object.values(META)) hosts.add(new URL(meta.url).hostname.replace(/^www\./, ''));
  for (const file of ['extract.mjs', 'functions/api/read.js', 'site/app.js']) {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const host of hosts) assert.ok(!code.includes(host), `${file} names ${host}`);
  }
});

test('scramble removes the words but keeps the shape', () => {
  const sentence = 'The quick brown fox, “jumps” over 12 lazy dogs.';
  const out = scramble(sentence);
  assert.equal(out, scramble(sentence));  // the same text scrambles the same, so a title still matches its heading
  for (const word of ['quick', 'brown', 'jumps', 'lazy', 'dogs']) assert.ok(!out.includes(word));
  assert.deepEqual(out.split(' ').map(w => w.length), sentence.split(' ').map(w => w.length));
  assert.match(out, /^[A-Z].*,.*“.*”.*\.$/);
  assert.equal(scramble('12 min read'), '12 min read');  // short chrome stays real
  assert.equal(scramble('Table of Contents'), 'Table of Contents');
  assert.notEqual(scramble('Exposure and Timeline'), 'Exposure and Timeline');
});

test('scramblePage judges a line whole, so links and bold can\u2019t shield the words between them', () => {
  const page = scramblePage('<html><body><p>Report it <a href="/x">through the tracker</a> or <b>the feedback form</b> today.</p><p><span>12 min read</span></p></body></html>');
  for (const leak of ['Report', 'through', 'tracker', 'feedback', 'today']) assert.ok(!page.includes(leak), leak);
  assert.ok(page.includes('12 min read'));
  assert.ok(page.includes('href="/x"'));
  const table = scramblePage('<html><body><table><tr><td>Exposed</td><td>Malware</td></tr><tr><td>Secret</td><td>Backdoor</td></tr><tr><td>Campaign</td><td>Payload</td></tr></table><pre><div>const answer</div><div>= compute</div><div>(input, other)</div></pre></body></html>');
  for (const leak of ['Exposed', 'Backdoor', 'Payload', 'answer', 'compute']) assert.ok(!table.includes(leak), leak);
});

test('scramblePage drops scripts, which can hold the whole article, and scrambles metadata', () => {
  const page = scramblePage(`<html><head><title>A title that is long enough to go</title><meta name="description" content="A description of the story in several real words"><script>{"articleBody":"secret"}</script></head><body><p>${'The real text of the story goes here. '.repeat(3)}</p></body></html>`);
  for (const leak of ['secret', 'description of the story', 'real text', 'long enough']) assert.ok(!page.includes(leak), leak);
});
