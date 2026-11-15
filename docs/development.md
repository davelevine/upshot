# Development

This page is for working on Upshot's code: running the build and the site locally, running the tests, and the conventions to follow when you change things. Deploys and CI are in [Hosting](architecture/hosting.md).

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
npm ci
```

To run the build, install the Claude Code CLI (`npm i -g @anthropic-ai/claude-code`). It writes real data, so don't commit a local run's output unless you mean to:

```bash
CLAUDE_CODE_OAUTH_TOKEN=... .venv/bin/python build.py
```

## Serving the site

The reader needs the Workers runtime, so use Wrangler:

```bash
npx wrangler dev -c wrangler.jsonc -c sync/wrangler.jsonc --infer-origin-from-routes=false --port 8788
```

The two `-c` flags run the site's Worker and `upshot-sync` together, bound as they are when deployed. `--infer-origin-from-routes=false` lets the Worker see the address you opened, which its same-origin check needs.

Sync's session cookie is `Secure`, which browsers waive only for `localhost`. To try sync on another device, serve the site over HTTPS (add `--local-protocol https --upstream-protocol https`) at an address that device can reach.

**Fonts.** `wrangler dev` uses an empty local copy of the R2 bucket, so the site shows system fonts. If you have the licensed fonts, load them once:

```bash
for f in /path/to/fonts/{Sohne,Mercury}-*.woff2; do npx wrangler r2 object put "upshot-fonts/$(basename "$f")" --file "$f" --content-type font/woff2 --local; done
```

They stay in `.wrangler/state`. A server started with its own `--persist-to` needs the same step with that flag.

## Tests

```bash
.venv/bin/pytest -q
node --test 'tests/*.test.js'
```

Sync's Durable Object rules are unit-tested against a real SQLite with a controllable clock, in `tests/reader.test.js`.

The browser smoke test runs against the dev server above:

```bash
.venv/bin/pip install playwright axe-playwright-python pytest-xdist && .venv/bin/python -m playwright install chromium
SMOKE_URL=http://127.0.0.1:8788 .venv/bin/pytest -q -n auto tests/test_smoke.py
```

It loads the site in Chromium under its real CSP and checks the feed, the reader, search, swipe-back, sync between two browsers, and WCAG 2.2 AA with axe. It fails on any CSP violation, console error or page error. It serves Public Sans from `fonts/` in place of the licensed fonts. Drop `-n auto` to run tests one at a time when debugging.

## Things to know

- **CSP hashes.** If you change the theme script in `index.html` or the relay script in `app.js`, `node --test` prints the new hash for `site/_headers`.
- **Reader fixtures.** Every publisher in `feeds.opml` has a scrambled test page under `tests/fixtures/` (see [Configuration](setup/configuration.md) for how to add one). When a page breaks the reader, save it the same way and fix the rule in `tidy()`, keyed on what the element is, never on a site's name or class.
- **Category names.** A category has one name everywhere: its label in `app.js`, its id in `build.py` (`CATEGORIES`, the bars, the scoring prompt), `data.json` and the `--cat-*` colors. To rename one, change them all, and map the old id to the new one in `build.py` (on loading `data.json`) and `app.js` until a build has rewritten every stored story; then delete the mapping.
- **Durable Object storage.** Tables are created in the constructors (`CREATE TABLE IF NOT EXISTS`). A new column needs an `ALTER TABLE` there too; a new Durable Object class needs a new entry in `migrations` in [`sync/wrangler.jsonc`](../sync/wrangler.jsonc). Changes to `sync/` deploy only from `main`, so try them locally first.
