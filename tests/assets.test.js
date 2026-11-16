import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url));

// Browsers keep app.js for a year (site/_headers), so the page must ask for it by a URL that changes with its contents.
// Edit app.js and this fails until index.html carries the new version.
test('index.html loads app.js by the hash of its contents', () => {
  const v = createHash('sha256').update(read('site/app.js')).digest('hex').slice(0, 10);
  const html = read('site/index.html').toString();
  assert.ok(html.includes(`<script src="/app.js?v=${v}"></script>`), `site/index.html must load /app.js?v=${v}`);
  assert.equal(html.match(/<script[^>]*\ssrc="[^"]*app\.js/g).length, 1, 'app.js is loaded in one place');
});
