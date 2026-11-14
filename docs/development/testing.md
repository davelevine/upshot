# Testing

Upshot has three layers of tests: Python unit tests for the pipeline, JavaScript unit tests for the site and sync, and a browser smoke test that loads the real site. This page covers how to run each, plus a few things worth knowing before you change the code. Setup is in [Running locally](local.md).

## Unit tests

```bash
.venv/bin/pytest -q
node --test 'tests/*.test.js'
```

## The browser smoke test

The smoke test runs against a live dev server, so start `npx wrangler dev -c wrangler.jsonc -c sync/wrangler.jsonc --infer-origin-from-routes=false --port 8788` first (see [Serving the site](local.md#serving-the-site)). Then:

```bash
.venv/bin/pip install playwright axe-playwright-python pytest-xdist && .venv/bin/python -m playwright install chromium
SMOKE_URL=http://127.0.0.1:8788 .venv/bin/pytest -q -n auto tests/test_smoke.py
```

`-n auto` runs a worker per core, the same way CI does (four there). Drop it to run one test at a time, which is what you want when you're debugging a single test.

It loads the site in Chromium under its real CSP and checks:

- the feed
- the reader
- the search palette
- swipe-back
- sync (two browsers joined by code, on `localhost`)
- WCAG 2.2 AA (axe)

It fails on any CSP violation, console error or page error.

It doesn't need the licensed fonts. It serves Public Sans's bytes (from `fonts/`) in their place, which is enough to check which face each weight and theme loads, and that no article downloads a font again.

## Things to know when changing the code

- **CSP hashes.** If you change the theme script in `index.html` or the relay script in `app.js`, `node --test` prints the new hash to put in `site/_headers`.
- **Reader fixtures.** Every publisher in `feeds.opml` has a saved test page under `tests/fixtures/`, with its article text scrambled. When a real page breaks the reader, save it the same way (see [Adding a feed](../setup/feeds.md)), then fix the rule in `tidy()`. The rule should key on what the element is, never on a site's name or class.
- **Category names.** A category has one name everywhere: its label in `app.js`, its id in `build.py` (`CATEGORIES`, the bars, the scoring prompt), `data.json` and the `--cat-*` colours. To rename one, change them all, and map the old id to the new one in both `build.py` (on loading `data.json`) and `app.js`. Leave the mapping in place until a build has rewritten every stored story, so none of them vanish; then delete it.
