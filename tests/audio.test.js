// audio.mjs: the blocks a story is voiced as, which must be the blocks the reader's frame marks while it plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BLOCKS, INSIDE, blocksFor, siteStore, storyBlocks } from '../audio.mjs';
import { dns, readArticle } from '../extract.mjs';
import { keyFor } from '../worker.js';

dns.lookup = async () => [{ address: '203.0.113.1', family: 4 }];  // every test host is public (a documentation address); no network

// A saved page as the build stores it.
async function stored(file, url) {
  const html = readFileSync(new URL(`./fixtures/pages/${file}`, import.meta.url), 'utf8');
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  try { return await readArticle({ url, publisher: '' }); } finally { globalThis.fetch = real; }
}
const texts = html => blocksFor({ title: 'T' }, html).slice(1).map(b => `${b.kind}: ${b.text}`);

const story = { title: 'A <flaw> & a fix', tldr: ['First point.', 'Second point.'], summary: 'It happened.' };

test('a story reads as its headline, its upshot as one block, then the article', () => {
  const html = '<h2>Overview</h2><p>One <b>bold</b> paragraph.</p><ul><li><p>A nested point.</p></li><li>Another.</li></ul>'
    + '<blockquote><p>Quoted.</p></blockquote><p>   </p><p>—</p><table><tr><td>Not read</td></tr></table>';
  assert.deepEqual(blocksFor(story, html), [
    { kind: 'title', text: 'A <flaw> & a fix' },
    { kind: 'upshot', text: 'The upshot. First point. Second point.' },
    { kind: 'head', text: 'Overview' },
    { kind: 'text', text: 'One bold paragraph.' },
    { kind: 'text', text: 'A nested point.' },  // a paragraph inside a list item is read with it, once
    { kind: 'text', text: 'Another.' },
    { kind: 'text', text: 'Quoted.' },
    { kind: 'text', text: '—' },  // no letters, but on the page all the same: audio.py keeps it, silent, for the count
  ]);
});

test("a story without an upshot has no upshot block, and a card is read as its summary", () => {
  assert.deepEqual(blocksFor({ ...story, tldr: [] }, '<p>Body.</p>').map(b => b.kind), ['title', 'text']);
  assert.deepEqual(blocksFor(story, null), [
    { kind: 'title', text: 'A <flaw> & a fix' },
    { kind: 'upshot', text: 'The upshot. First point. Second point.' },
    { kind: 'text', text: 'It happened.' },
  ]);
});

test('a real article reads as a sensible run of blocks', async () => {
  const record = await stored('aikido.html', 'https://www.aikido.dev/blog/x');
  assert.equal(record.reason, 'ok');
  const blocks = blocksFor(story, record.content);
  assert.ok(blocks.length > 10, `${blocks.length} blocks`);
  assert.deepEqual(blocks.slice(0, 2).map(b => b.kind), ['title', 'upshot']);
  assert.ok(blocks.slice(2).every(b => b.kind !== 'title' && b.kind !== 'upshot' && b.text === b.text.trim() && !/\s\s/.test(b.text)));
});

test('a paragraph ends where a browser ends it, at a block inside it', () => {
  // What Chromium gives for the same markup; linkedom alone keeps each of these as one paragraph.
  assert.deepEqual(texts('<p><span><p>a</p><h3>b</h3></span></p><p>c</p>'), ['text: a', 'head: b', 'text: c']);
  assert.deepEqual(texts('<p>x<b>y<p>a</p>z</b>w</p><p>v</p>'), ['text: xy', 'text: a', 'text: v'], 'what follows the inner block is loose text, in no block');
  assert.deepEqual(texts('<p>a<span>s<div>d<p>e</p>f</div>g</span>h</p><p>i</p>'), ['text: as', 'text: e', 'text: i']);
  assert.deepEqual(texts('<p>a <a href="https://x.test/">link<p>b</p>more</a> c</p>'), ['text: a link', 'text: b']);
  // These linkedom parses as a browser does, and they stay that way.
  assert.deepEqual(texts('<p>x<p>a</p>y</p>'), ['text: x', 'text: a']);
  assert.deepEqual(texts('<p>a<ul><li>b</li></ul>c</p>'), ['text: a', 'text: b']);
  assert.deepEqual(texts('<p>a<div>b</div></p>'), ['text: a']);
  assert.deepEqual(texts('<p>a<button>k<p>b</p></button>c</p>').length, 1, 'a button keeps the paragraph around it open');
  assert.deepEqual(texts('<ul><li><p>a<span><p>b</p></span></p></li></ul>').length, 1, 'still one list item');
});

test('pages with blocks nested in a paragraph split into the blocks a browser counts', async () => {
  // Counted in Chromium with the frame's rule on the same stored HTML.
  const pages = [['crowdstrike.html', 'https://www.crowdstrike.com/en-us/blog/x', 53], ['the-record.html', 'https://therecord.media/x', 15]];
  for (const [file, url, count] of pages) {
    const record = await stored(file, url);
    assert.equal(record.reason, 'ok', file);
    assert.equal(blocksFor(story, record.content).length, count, file);
  }
});

test('words either side of a line break or a block inside a block stay apart', async () => {
  assert.deepEqual(texts('<p>First line<br>second line</p><p>one<br/><br>two</p>'), ['text: First line second line', 'text: one two']);
  assert.deepEqual(texts('<blockquote><p>One.</p><p>Two.</p></blockquote>'), ['text: One. Two.']);
  assert.deepEqual(texts('<ul><li>a<ul><li>b</li><li>c</li></ul>d</li></ul>'), ['text: a b c d'], 'where an inner block starts, too');
  assert.deepEqual(texts('<p>One <b>bo</b>ld, <a href="https://x.test/">link</a>ed &amp; &lt;kept&gt;.</p>'), ['text: One bold, linked & <kept>.'], 'inline markup adds no space');
  // 13 blocks on the saved pages run words together without this; one page stands for them.
  const record = await stored('wiz.html', 'https://www.wiz.io/blog/x');
  const fused = blocksFor(story, record.content).filter(b => /[a-z]\.[A-Z][a-z]+ [A-Z]/.test(b.text));
  assert.deepEqual(fused, []);
});

test('storyBlocks reads stored articles, a blocked one as its card, and leaves the unstored waiting', async () => {
  const ok = 'https://x.test/ok', blocked = 'https://x.test/blocked', missing = 'https://x.test/missing';
  const stored = new Map([[await keyFor(ok), { reason: 'ok' }], [await keyFor(blocked), { reason: 'challenge' }]]);
  const gets = [];
  const kv = { list: async () => stored, get: async key => { gets.push(key); return { content: '<p>The article.</p>' }; } };
  const out = await storyBlocks([ok, blocked, missing].map(url => ({ url, ...story })), kv);
  assert.deepEqual(out[ok].blocks.map(b => b.text).slice(-1), ['The article.']);
  assert.deepEqual(out[blocked], { reason: 'challenge', blocks: blocksFor(story, null) });
  assert.deepEqual(out[missing], { reason: 'pending', blocks: [] });
  assert.deepEqual(gets, [await keyFor(ok)], 'only a stored article is fetched');
});

test('a dry run reads the same records from the public reader, with no token', async () => {
  const ok = 'https://x.test/ok', blocked = 'https://x.test/blocked', missing = 'https://x.test/missing';
  const answers = { [ok]: { reason: 'ok', content: '<p>The article.</p>' }, [blocked]: { reason: 'challenge' }, [missing]: { reason: 'pending' } };
  const asked = [];
  const get = async u => { asked.push(u); return { json: async () => answers[new URL(u).searchParams.get('url')] }; };
  const items = [ok, blocked, missing].map(url => ({ url, ...story }));
  const out = await storyBlocks(items, siteStore('https://site.test', items, get));
  assert.deepEqual(out[ok].blocks.map(b => b.text).slice(-1), ['The article.']);
  assert.deepEqual(out[blocked], { reason: 'challenge', blocks: blocksFor(story, null) });
  assert.deepEqual(out[missing], { reason: 'pending', blocks: [] });
  assert.ok(asked.every(u => u.startsWith('https://site.test/api/read?url=')));
});

test('keys match the Python side', async () => {
  assert.equal(await keyFor('https://example.test/1'), '98780052059c9103799e803c8bf1e4a75c7edd58bc3e67bae3cc0a2dd1ab224a');  // test_audio.py
});

test("the frame marks the same blocks the audio was timed by", () => {
  // The relay in site/app.js finds a page's blocks while it plays; audio.mjs found the same ones to time the audio.
  const app = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
  const relay = /const SWIPE_REPORTER = `([\s\S]*?)`;\n/.exec(app)[1];
  const listen = relay.slice(relay.indexOf("e.data.tw === 'listen'"));
  assert.equal(/querySelectorAll\('([^']+)'\)/.exec(listen)[1], BLOCKS, 'which elements are blocks');
  assert.equal(/parentElement\.closest\('([^']+)'\)/.exec(listen)[1], INSIDE, 'which are read with the block around them');
});

test('a definition list reads each term with its definition', () => {
  assert.deepEqual(texts('<dl><dt>Term</dt><dd>Its definition.</dd><dt><p>Wrapped term</p></dt><dd>Another.</dd></dl>'),
    ['text: Term', 'text: Its definition.', 'text: Wrapped term', 'text: Another.']);
});
