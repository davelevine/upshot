<!--markdownlint-disable-->

[![Build](https://github.com/davelevine/upshot/actions/workflows/build.yml/badge.svg)](https://github.com/davelevine/upshot/actions/workflows/build.yml)
[![Site](https://img.shields.io/badge/upshot.levine.io-live-73dbcc?labelColor=2c3e50)](https://upshot.levine.io)
[![RSS](https://img.shields.io/badge/RSS-feed-ebb077?logo=rss&logoColor=ebb077&labelColor=2c3e50)](https://upshot.levine.io/rss.xml)

<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/wordmark-dark.svg">
    <img src=".github/wordmark-light.svg" alt="Upshot" width="200">
  </picture>
</h1>

The week’s tech news, minus the noise.

</div>

<div align="center">

| Pipeline | Site | AI | Automation |
|---|---|---|---|
| [![Python](https://img.shields.io/badge/Python-%232c3e50?logo=python&logoColor=FFD43B&labelColor=2c3e50)](https://www.python.org/) [![feedparser](https://img.shields.io/badge/feedparser-%232c3e50?logo=rss&logoColor=F99B34&labelColor=2c3e50)](https://github.com/kurtmckee/feedparser) | [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-%232c3e50?logo=cloudflareworkers&logoColor=F38020&labelColor=2c3e50)](https://workers.cloudflare.com/) [![JavaScript](https://img.shields.io/badge/Vanilla%20JS-%232c3e50?logo=javascript&logoColor=F7DF1E&labelColor=2c3e50)](https://developer.mozilla.org/en-US/docs/Web/JavaScript) [![Readability](https://img.shields.io/badge/Readability-%232c3e50?logo=firefoxbrowser&logoColor=FF7139&labelColor=2c3e50)](https://github.com/mozilla/readability) | [![Claude](https://img.shields.io/badge/Claude%20Haiku-%232c3e50?logo=claude&logoColor=D97757&labelColor=2c3e50)](https://www.anthropic.com/claude) | [![GitHub Actions](https://img.shields.io/badge/Actions-%232c3e50?logo=githubactions&logoColor=2088FF&labelColor=2c3e50)](https://github.com/features/actions) |

</div>

Upshot is a set-it-and-forget-it news digest covering AI, security, infrastructure, software engineering and tech regulation. It reads a curated list of feeds, has an LLM keep only the stories worth your time, writes each one up in a sentence, and picks five weekly essentials, each with what to do about it. It's inspired by [watch.edebost.com](https://watch.edebost.com/).

There's no server and no database to look after. A scheduled GitHub Actions job does the work and commits a small JSON file; a single static page renders it. Everything runs on the free tiers of GitHub Actions and Cloudflare Workers, plus a Claude subscription.

**Contents:** [What you get](#what-you-get) · [How it works](#how-it-works) · [Run your own copy](#run-your-own-copy) · [Developing](#developing) · [Built With Claude](#built-with-claude) · [Credits](#credits)

## What you get

- **A calm feed:** headlines and their sources, a handful on a big day and none on a slow one, grouped by day, with category filters, search and infinite scroll. Each story's summary and upshot open with it in the reader.
- **The week's essentials:** five picks from the last seven days, each with what to do about it, in a sentence, shown at the end of its upshot in the reader.
- **A built-in reader:** articles open in a clean reading pane, Feedbin-style, each starting with the upshot: two to four bullets on what happened, who's affected and what to do. When a site won't give up its text, you get the original page or a link instead.
- **Remembers where you were:** articles added since your last visit are marked New, and ones you've read are dimmed. This lives in your browser only.
- **Feels native on a phone:** swipe right to close the reader, arrows at the bottom move between stories, and Chrome on Android can install it as an app.
- **Keyboard-first on a desktop:** a ⌘K / Ctrl+K search palette, `j`/`k` or arrow-key navigation, and `?` for the full list.
- **Light and dark themes, an RSS feed, and a page that refreshes itself** when a new build lands.

<details>
  <summary><strong>Keyboard shortcuts</strong></summary>

| Keys | Action |
| ---- | ------ |
| <kbd>⌘</kbd> <kbd>K</kbd> / <kbd>Ctrl</kbd> <kbd>K</kbd> | Search palette: type, <kbd>↑</kbd>/<kbd>↓</kbd> to choose, <kbd>Enter</kbd> to read |
| <kbd>j</kbd> / <kbd>→</kbd> | Next article (switches articles inside the reader too) |
| <kbd>k</kbd> / <kbd>←</kbd> | Previous article |
| <kbd>Enter</kbd> | Open the focused article |
| <kbd>/</kbd> | Search every article, like <kbd>⌘K</kbd> (so does clicking the search bar) |
| <kbd>Esc</kbd> | Close the palette, the reader or the shortcut list |
| <kbd>?</kbd> | Show these shortcuts |

The reader's bar shows the publisher's icon (fetched once by the build and served from the site), with buttons for text size (four sizes, remembered on your device), share and theme. Click the headline to open the original.

</details>

## How it works

### The pipeline

Every four hours the Build workflow runs [`build.py`](build.py):

1. **Fetch:** reads every feed in [`feeds.opml`](feeds.opml). A broken feed is skipped, never fatal.
2. **Filter:** keeps dated entries from the last few days that haven't been seen before, capped per feed.
3. **Score:** sends each new story to Claude Haiku (`claude-haiku-5-5`) on its own, through the Claude Code CLI on a Claude subscription, so a story's score never depends on what it was batched with. Each gets a category, a 1-10 relevance score judged within its category, and a one-sentence summary.
4. **Keep the notable ones:** a story is published if it clears its category's bar (8 for Security and Regulation, 7 for AI and Other, 6 for Infrastructure and Engineering) and isn't a repeat. There are no per-category quotas, so a big security day shows as one and a slow day stays short. Nothing published is ever taken down; a 20-story daily cap exists only to catch a malfunction, like a broken feed.
5. **Drop repeats:** the model flags a story that's already on the site from the past week (the same launch from another outlet, say). The code checks that claim, so one copy always survives.
6. **Pick the essentials:** once a day, the model chooses the week's five.
7. **Extract:** [`extract.mjs`](extract.mjs) pulls each new story's text into Cloudflare KV for the reader (details below).
8. **Publish:** writes [`site/data.json`](site/data.json) and [`site/rss.xml`](site/rss.xml), remembers seen URLs in `state.json`, commits, and Cloudflare deploys the Worker on the push.

Everything older than 90 days is pruned, so the data stays small.

### The site

[`site/index.html`](site/index.html) and [`site/app.js`](site/app.js) are the whole front end: no framework, no build step. [`site/_headers`](site/_headers) sets the Content-Security-Policy. [`worker.js`](worker.js) serves the static files and answers `/api/read` for the reader; [`wrangler.jsonc`](wrangler.jsonc) configures the Worker.

### The reader, and what it does with your data

Each build extracts new stories with Mozilla's [Readability](https://github.com/mozilla/readability), the same approach as Firefox's reader view, and stores the result in Cloudflare KV. Opening an article calls `/api/read`, which the Worker answers with what's stored. Parsing happens in the build because it costs far more CPU than the Worker is allowed per request on the free plan.

- **Each article opens with the upshot.** Two to four bullets, written once by the build from the article itself. Every figure in a bullet (CVE IDs, versions, dates, counts) must appear word for word in the article, or that bullet is dropped. The weekly essentials add their hand-picked "What to do" as the last line.
- **Page furniture is removed by what it is, never by who published it.** Bylines, dates, tables of contents, same-page links and "N min read" lines come out before the article is stored. If that would remove more than 35% of the text, the article is kept whole instead, because a stray byline beats a lost paragraph.
- **Article text is stored, but not in this repository.** It sits in a private KV namespace and expires after 100 days, shortly after a story leaves the site. It's a snapshot from when the story was first read, so later corrections by the publisher won't appear.
- **It says why when it can't.** Every response carries a reason: `ok`, `challenge` (the publisher blocks it), `shell`, `short`, `not_html` or `pending` (no article yet). Your screen already shows the story's summary from `data.json`, so a block never leaves it empty. Blocked stories are tried again on every build, and if a blocked publisher's feed carries whole articles, the build takes the article from the feed instead.
- **It isn't a proxy.** The Worker never fetches anything, and only returns articles the build stored.
- **The page can't run anything from the source site.** Extracted HTML is stripped of scripts, frames, styles and event handlers during the build, then rendered in a sandboxed frame with no access to the page; the only script allowed in there is the site's own swipe and keyboard relay, admitted by a per-render nonce.
- **A strict Content-Security-Policy backs all of this up.** Scripts load only from the site itself, plus two inline scripts allowed by exact hash; no plugins, forms or base-URL changes; network requests go only to the site. A test keeps the hashes in step with the code.
- **No login, no tracking.** Read and New markers live in your browser's local storage and never leave it.

### It looks after itself

A feed that has failed for two weeks, gone quiet or moved lands in a single "Feed health" issue that closes itself once it's fixed; for failing and quiet feeds it suggests any feeds the publisher's homepage advertises. A run where every LLM call fails exits with an error so GitHub emails you. If Cloudflare KV is down, the stories are still published (the reader shows a fallback until a later build stores their text) and the run is marked failed after committing, so you hear about it without losing the build.

## Run your own copy

Everything runs on the free tiers of GitHub Actions and Cloudflare Workers. The only paid piece is a Claude subscription (Pro or Max), which the build uses through the Claude Code CLI, so there's no API key and no per-token bill. Setup takes about fifteen minutes.

1. **Fork the repository.** GitHub turns workflows off in new forks, so open the fork's **Actions** tab and enable them.
2. **Create the Claude token.** On a machine where you're signed in to Claude Code with your subscription, run:

   ```bash
   claude setup-token
   ```

   It prints a long-lived OAuth token (it lasts about a year). In the fork, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `CLAUDE_CODE_OAUTH_TOKEN`, and paste the token. When it expires, builds start failing with "every scoring call failed"; run `claude setup-token` again and replace the secret.
3. **Give the reader somewhere to keep articles.** Do this before connecting Cloudflare, or the first deploy points at someone else's namespace. In Cloudflare, create a Workers KV namespace and put its ID in both `kv_namespaces` entries in [`wrangler.jsonc`](wrangler.jsonc) (the namespace ID isn't a secret). Create an API token with only the **Workers KV Storage: Edit** permission, then add `CF_API_TOKEN`, `CF_ACCOUNT_ID` and `CF_KV_NAMESPACE_ID` as repository secrets. Without them the digest still works, but the reader only shows each story's summary.
4. **Connect Cloudflare Workers.** In [`wrangler.jsonc`](wrangler.jsonc), change `routes` to your own domain, or delete it and set `workers_dev` to `true` to use the `workers.dev` address. Then in Cloudflare, go to **Workers & Pages → Create → Import a repository**, pick your fork, and name the Worker `upshot` (it must match `name` in `wrangler.jsonc`). Leave the build command empty and the deploy and preview commands at their defaults.
5. **Tell the build where the site lives.** Under **Settings → Secrets and variables → Actions → Variables**, add `SITE_URL` with your site's address (for example `https://news.example.com`). The build uses it for the RSS feed's links and to look up reading times through the site's reader.
6. **Make it yours.** Point the GitHub links, the stale-build link and the `og:url` tag in `site/index.html` at your fork and site, change the README badges, edit [`feeds.opml`](feeds.opml) (see [Adding a feed](#adding-a-feed)), and adjust the bars in [`build.py`](build.py) if you want more or fewer stories (see [Configuration](#configuration)).
7. **Run the first build.** Under **Actions → Build → Run workflow**, start it on `main`. Set `backfill_days` to `30` to fill in the last month (only as far back as each feed still lists). Cloudflare deploys the result a minute after the build commits.

### Adding a feed

Edit [`feeds.opml`](feeds.opml); each feed is one `<outline>` line, and its `text` attribute is the publisher name shown on the site. Some big publishers (Anthropic, Cohere, Reuters) don't publish RSS. Anthropic, Cohere and a few others come from community-maintained feeds, and the Hacker News 300+ feed catches most of the rest.

A feed isn't added until the reader has been proven on it, so CI fails until the new feed has a test page. It takes two commands:

```bash
node tests/fixtures/fetch.mjs "Publisher name"              # the name from feeds.opml
UPDATE_EXPECTED=1 node --test tests/fixtures.test.js        # records what the reader makes of it
```

The saved page has its article text scrambled, so no publisher's writing ends up in your repository. Check the diff of `tests/fixtures/expected.json`, then commit both.

Once it's merged, give the feed's back catalogue a chance: builds only look back three days, so older posts are never considered otherwise. Under **Actions → Build → Run workflow**, set `backfill_days` to `30`. Only stories the build hasn't seen before are scored, so the rest of the site is untouched. The same manual run fills in history for a new fork; everything already seen is skipped, so it's safe to rerun, but a backfill can only reach as far back as each feed still goes.

### Configuration

The knobs live at the top of [`build.py`](build.py):

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `MIN_RELEVANCE` | 8 for Security and Regulation, 7 for AI and Other, 6 for Infrastructure and Engineering | Score a story needs to be published; the bars differ only to match how Haiku scores each category |
| `NEWS_SOURCES` | Six outlets | Lose ties to, and get replaced by, the original source |
| `DAILY_MAX` | 20 | Most stories a day can show: above the busiest real day, so it only trips on a malfunction |
| `DEDUPE_DAYS` | 7 | How far back to look for repeat coverage |
| `FRESH_DAYS` | 3 | Ignore feed entries older than this (env-overridable) |
| `PER_FEED` | 10 | Newest entries taken per feed per run (env-overridable) |
| `KEEP_DAYS` | 90 | Prune articles and seen URLs older than this |
| `DEAD_AFTER_DAYS` | 14 | Days of failures before a feed is reported |
| `UPSHOT_MODEL` | `claude-haiku-5-5` | Model used for scoring, repeats and the weekly picks (env). The build fails if the CLI answers with a different model |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI (env) |
| `SITE_TZ` | `America/New_York` | The time zone stories are dated in and "Today" means, on every device (env; set as a repo variable in forks) |
| `SITE_URL` | `https://upshot.levine.io` | The site's address, for the feed's links (env; set as a repo variable in forks) |

How often it runs is the `cron` line in [`build.yml`](.github/workflows/build.yml).

<details>
  <summary><strong>Keeping the schedule on time</strong></summary>

The workflow runs every four hours on GitHub's own scheduler, which often starts late and sometimes skips a slot. For a dependable cadence, trigger it from any scheduler you already have (cron, a systemd timer, a hosted cron service) with a fine-grained personal access token limited to your fork, with **Actions: read and write**:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $GITHUB_DISPATCH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{"ref":"main"}' \
  https://api.github.com/repos/<you>/upshot/actions/workflows/build.yml/dispatches
```

Leave the built-in schedule in place as a fallback; a duplicate run finds nothing new.

</details>

<details>
  <summary><strong>Optional: Renovate</strong></summary>

Install the [Renovate app](https://github.com/apps/renovate) on the fork; [`renovate.json`](renovate.json) is already set up. It keeps every pin current: the GitHub Actions (pinned to commit digests), `feedparser`, Readability and linkedom, Wrangler, and the Playwright version in the smoke job. New releases wait three days before an update is proposed. Patch, digest and minor updates merge themselves once CI passes, including the browser smoke test. Major versions and the Claude Code CLI (which PR checks can't fully test, since they don't run the real build) wait for review, arriving together on the 1st of each month.

</details>

## Developing

Run the pipeline locally (it writes real data, so don't commit a local run's output unless you mean to):

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

If you change the theme script in `index.html` or the relay script in `app.js`, `node --test` prints the new CSP hash to put in `site/_headers`.

When a real page breaks the reader, save it as a fixture the same way as [adding a feed](#adding-a-feed), then fix the rule in `tidy()` so it keys on what the element is, never on a site's name or class.

<details>
  <summary><strong>Running the browser smoke test</strong></summary>

With `npx wrangler dev --port 8788` running:

```bash
.venv/bin/pip install playwright axe-playwright-python && .venv/bin/python -m playwright install chromium
SMOKE_URL=http://127.0.0.1:8788 .venv/bin/pytest -q tests/test_smoke.py
```

</details>

### CI/CD

| Workflow | Function | PR | Manual | Scheduled | Details |
| -------- | -------- | :-: | :----: | :-------: | ------- |
| [Build](./.github/workflows/build.yml) | Fetch, score, publish | ✓ | ✓ | ✓ | Every 4 hours at :17 UTC. On PRs it runs the Python and JavaScript tests only. Manual runs take an optional `backfill_days`. |
| [Build › smoke](./.github/workflows/build.yml) | Browser smoke test | ✓ | | | Loads the site in Chromium under its real CSP and checks the feed, reader, search palette, swipe-back and WCAG 2.2 AA (axe). Fails on any CSP violation, console error or page error. |

Cloudflare Workers Builds deploys every push to `main` with `npx wrangler deploy`, including the bot's data commits, and builds a Preview for every other branch with its URL posted on the PR.

[`wrangler.jsonc`](wrangler.jsonc) holds the Worker's config: static assets from `site/` with `404.html` for unknown paths; code runs only for `/api/read` and for pages, which get a per-request CSP nonce so Cloudflare's Bot Fight Mode script can run; the `ARTICLES` KV binding; the custom domain; preview URLs for PRs; and Workers Logs, which keep a few days of the Worker's requests and errors.

The build's secrets live in the repo's Actions secrets: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`; lasts about a year) and the three `CF_` secrets that let the build store articles in KV. Scheduled and manual builds install the pinned Claude Code CLI to use it.

## Built With Claude

This project was built using AI-assisted development with [Claude](https://claude.ai). I told it what to build and then said "no, not like that" a lot. The AI did a lot of typing. Commits with substantial AI contributions are marked with `Co-authored-by` tags because we're not going to pretend otherwise.

## Credits

- [watch.edebost.com](https://watch.edebost.com/) — the inspiration, design language and palette
- [Mozilla Readability](https://github.com/mozilla/readability) and [linkedom](https://github.com/WebReflection/linkedom) — article extraction
- [feedparser](https://github.com/kurtmckee/feedparser) — making sense of every feed format there is
