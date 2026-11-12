# Developing

## Running locally

Run the pipeline. It writes real data, so don't commit a local run's output unless you mean to:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
.venv/bin/pytest -q
CLAUDE_CODE_OAUTH_TOKEN=... .venv/bin/python build.py   # needs the Claude Code CLI (npm i -g @anthropic-ai/claude-code)
```

Then serve the site. The reader needs the Workers runtime, so use Wrangler rather than a plain static server:

```bash
npm ci
node --test 'tests/*.test.js'
npx wrangler dev --port 8788
```

## The browser smoke test

With `npx wrangler dev --port 8788` running:

```bash
.venv/bin/pip install playwright axe-playwright-python && .venv/bin/python -m playwright install chromium
SMOKE_URL=http://127.0.0.1:8788 .venv/bin/pytest -q tests/test_smoke.py
```

It loads the site in Chromium under its real CSP and checks the feed, reader, search palette, swipe-back and WCAG 2.2 AA (axe). It fails on any CSP violation, console error or page error.

## Things to know when changing the code

- **CSP hashes.** If you change the theme script in `index.html` or the relay script in `app.js`, `node --test` prints the new hash to put in `site/_headers`.
- **Reader fixtures.** Every publisher in `feeds.opml` has a saved test page under `tests/fixtures/`, with its article text scrambled. When a real page breaks the reader, save it the same way (see [Adding a feed](setup.md#adding-a-feed)), then fix the rule in `tidy()` so it keys on what the element is, never on a site's name or class.
- **Category names.** A category has one name everywhere: its label in `app.js`, its id in `build.py` (`CATEGORIES`, the bars, the scoring prompt), `data.json` and the `--cat-*` colours. To rename one, change them all and map the old id to the new one in both `build.py` (on loading `data.json`) and `app.js` until a build has rewritten every stored story, so none vanish; then delete the mapping.

## CI/CD

| Workflow | Function | PR | Manual | Scheduled | Details |
| -------- | -------- | :-: | :----: | :-------: | ------- |
| [Build](../.github/workflows/build.yml) | Fetch, score, publish | ✓ | ✓ | ✓ | Every hour at :17 UTC, started by the Worker's cron; GitHub's own schedule is the fallback and skips an hour the Worker already started. On PRs it runs the Python and JavaScript tests only. Manual runs take an optional `backfill_days`. |
| [Build › smoke](../.github/workflows/build.yml) | Browser smoke test | ✓ | | | The test above, against `wrangler dev` in the workflow. |

Cloudflare Workers Builds deploys every push to `main` with `npx wrangler deploy`, including the bot's data commits, and builds a Preview for every other branch with its URL posted on the PR.

The build's secrets live in the repo's Actions secrets: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`; lasts about a year) and the three `CF_` secrets that let the build store articles in KV. Scheduled and manual builds install the pinned Claude Code CLI to use it.

Dependency updates are handled by Renovate; see [setup.md](setup.md#optional-renovate).
