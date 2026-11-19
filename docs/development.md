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

**Fonts.** `wrangler dev` uses an empty local copy of the R2 bucket, so the site shows system fonts. To see the real ones, load the files once (the list is in [Configuration](setup/configuration.md#fonts)):

```bash
for f in /path/to/fonts/{Sohne,Domaine,Literata,AtkinsonNext}-*.woff2; do npx wrangler r2 object put "upshot-fonts/$(basename "$f")" --file "$f" --content-type font/woff2 --local; done
```

They stay in `.wrangler/state`. A server started with its own `--persist-to` needs the same step with that flag.

## Tests

```bash
.venv/bin/pytest -q
node --test 'tests/*.test.js'
```

[`test_pipeline.py`](../test_pipeline.py) runs whole builds, two in a row, over scripted feeds, a scripted model and a scripted CISA catalog, and checks the files they write against [the pipeline](architecture/pipeline.md)'s rules and the `data.json` fields `app.js` reads. The Build workflow runs it before every hourly build, so it has to stay offline and deterministic: script anything new that `main()` reaches out to.

[`test_audio.py`](../test_audio.py) runs `audio.py` with the voice, the encoder, the bucket and the stored articles scripted, so it needs neither Kokoro nor Cloudflare; [`tests/audio.test.js`](../tests/audio.test.js) checks the blocks `audio.mjs` makes of a story. Voicing for real needs `pip install -r requirements-audio.txt` and the two model files the Audio workflow downloads.

Sync's Durable Object rules are unit-tested against a real SQLite with a controllable clock, in `tests/reader.test.js`.

The browser smoke test runs against the dev server above:

```bash
.venv/bin/pip install playwright axe-playwright-python pytest-xdist && .venv/bin/python -m playwright install chromium
SMOKE_URL=http://127.0.0.1:8788 .venv/bin/pytest -q -n auto tests/test_smoke.py
```

It loads the site in Chromium under its real CSP and checks the feed, the reader, search, swipe-back, sync between two browsers, and WCAG 2.2 AA with axe. It fails on any CSP violation, console error or page error. It serves Public Sans from `fonts/` in place of every font in R2. Drop `-n auto` to run tests one at a time when debugging.

## Things to know

- **CSP hashes.** If you change the theme script in `index.html` or the relay script in `app.js`, `node --test` prints the new hash for `site/_headers`.
- **`app.js` version.** Any change to `app.js` changes its hash, and `node --test` fails with the `/app.js?v=…` to put in `index.html`. Browsers keep it for a year, so a stale version would leave them on the old file.
- **Reader fixtures.** Every publisher in `feeds.opml` has a scrambled test page under `tests/fixtures/` (see [Configuration](setup/configuration.md) for how to add one). When a page breaks the reader, save it the same way and fix the rule in `tidy()`, keyed on what the element is, never on a site's name or class.
- **Category names.** A category has one name everywhere: its label in `app.js`, its id in `build.py` (`CATEGORIES`, the bars, the scoring prompt), `data.json` and the `--cat-*` colors. To rename one, change them all, and map the old id to the new one in `build.py` (on loading `data.json`) and `app.js` until a build has rewritten every stored story; then delete the mapping.
- **Durable Object storage.** Tables are created in the constructors (`CREATE TABLE IF NOT EXISTS`). A new column needs an `ALTER TABLE` there too; a new Durable Object class needs a new entry in `migrations` in [`sync/wrangler.jsonc`](../sync/wrangler.jsonc). Changes to `sync/` deploy only from `main`, so try them locally first.
