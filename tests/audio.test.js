// audio.mjs: the blocks a story is voiced as, which must be the blocks the reader's frame marks while it plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blocksFor, storyBlocks } from '../audio.mjs';
import { readArticle } from '../extract.mjs';
import { keyFor } from '../worker.js';

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
  const html = readFileSync(new URL('./fixtures/pages/aikido.html', import.meta.url), 'utf8');
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  let record;
  try { record = await readArticle({ url: 'https://www.aikido.dev/blog/x', publisher: '' }); } finally { globalThis.fetch = real; }
  assert.equal(record.reason, 'ok');
  const blocks = blocksFor(story, record.content);
  assert.ok(blocks.length > 10, `${blocks.length} blocks`);
  assert.deepEqual(blocks.slice(0, 2).map(b => b.kind), ['title', 'upshot']);
  assert.ok(blocks.slice(2).every(b => b.kind !== 'title' && b.kind !== 'upshot' && b.text === b.text.trim() && !/\s\s/.test(b.text)));
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

test('keys match the Python side', async () => {
  assert.equal(await keyFor('https://example.test/1'), '98780052059c9103799e803c8bf1e4a75c7edd58bc3e67bae3cc0a2dd1ab224a');  // test_audio.py
});
