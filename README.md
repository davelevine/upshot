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

The week's tech news, minus the noise.

</div>

<div align="center">

| Pipeline | Site | AI | Automation |
|---|---|---|---|
| [![Python](https://img.shields.io/badge/Python-%232c3e50?logo=python&logoColor=FFD43B&labelColor=2c3e50)](https://www.python.org/) [![feedparser](https://img.shields.io/badge/feedparser-%232c3e50?logo=rss&logoColor=F99B34&labelColor=2c3e50)](https://github.com/kurtmckee/feedparser) | [![Cloudflare Pages](https://img.shields.io/badge/Cloudflare%20Pages-%232c3e50?logo=cloudflarepages&logoColor=F38020&labelColor=2c3e50)](https://pages.cloudflare.com/) [![JavaScript](https://img.shields.io/badge/Vanilla%20JS-%232c3e50?logo=javascript&logoColor=F7DF1E&labelColor=2c3e50)](https://developer.mozilla.org/en-US/docs/Web/JavaScript) [![Readability](https://img.shields.io/badge/Readability-%232c3e50?logo=firefoxbrowser&logoColor=FF7139&labelColor=2c3e50)](https://github.com/mozilla/readability) | [![Claude](https://img.shields.io/badge/Claude%20Haiku-%232c3e50?logo=claude&logoColor=D97757&labelColor=2c3e50)](https://www.anthropic.com/claude) | [![GitHub Actions](https://img.shields.io/badge/Actions-%232c3e50?logo=githubactions&logoColor=2088FF&labelColor=2c3e50)](https://github.com/features/actions) |

</div>

## Overview

Upshot is a set-it-and-forget-it news digest covering AI, security, architecture, software delivery and tech regulation. It reads a curated list of feeds, has an LLM keep only the stories worth your time, writes each one up in a sentence, and picks five weekly essentials, each with what to do about it. It's inspired by [watch.edebost.com](https://watch.edebost.com/).

There's no server and no database to look after. A scheduled GitHub Actions job does the work and commits a small JSON file, and a single static page renders it:

- [`build.py`](build.py) fetches the feeds in [`feeds.opml`](feeds.opml), scores and summarizes new items with Claude Haiku, removes duplicate coverage, and writes [`site/data.json`](site/data.json) and [`site/rss.xml`](site/rss.xml).
- [`site/index.html`](site/index.html) and [`site/app.js`](site/app.js) are the whole front end: no framework, no build step. [`site/_headers`](site/_headers) sets the Content-Security-Policy.
- [`extract.mjs`](extract.mjs) runs during the build, pulling each new story's text into Cloudflare KV for the reader.
- [`functions/api/read.js`](functions/api/read.js) hands that text to the reader when you open an article.

### What you get

- **A calm feed:** a handful of stories on a big day and none on a slow one, grouped by day, with category filters, search and infinite scroll.
- **This week's essentials:** five picks, each with what to do about it, in a sentence, shown at the end of its upshot in the reader.
- **A built-in reader:** articles open in a clean reading pane, Feedbin-style. When a site won't give up its text, you get the original page or a link instead.
- **Remembers where you were:** articles added since your last visit are marked New, and ones you've read are dimmed. This lives in your browser only.
- **Feels native on a phone:** swipe right to close the reader, and Chrome on Android can install it as an app.
- **Keyboard-first on a desktop:** a ⌘K / Ctrl+K search palette, plus `j`/`k` or arrow-key navigation.
- **Light and dark themes, an RSS feed, and a page that refreshes itself** when a new build lands.

## How it works

Every four hours the Build workflow runs `build.py`:

1. **Fetch:** reads every feed. A broken feed is skipped, never fatal.
2. **Filter:** keeps dated entries from the last few days that haven't been seen before, capped per feed.
3. **Score:** sends each new story to Claude Haiku (`claude-haiku-5-5`) on its own, through the Claude Code CLI on a Claude subscription, so a story's score never depends on what it was batched with. Each gets a category, a 1-10 relevance score judged within its category, and a one-sentence summary.
4. **Keep the notable ones:** 8+ for AI and Security, 7+ for the quieter categories, with a daily safety cap for unusually big news days.
5. **Drop repeats:** the model flags a story that's already on the site from the past week (the same launch from another outlet, say). The code checks that claim, so one copy always survives.
6. **Pick the essentials:** once a day, the model chooses the week's five.
7. **Publish:** writes the data and RSS, remembers seen URLs in `state.json`, commits, and Cloudflare Pages deploys on the push.

Everything older than 90 days is pruned, so the data stays small. It also looks after itself: a feed that has failed for two weeks, gone quiet or moved lands in a single "Feed health" issue that closes itself once it's fixed, and a run where every LLM call fails exits with an error so GitHub emails you.

<details>
  <summary><strong>The reader, and what it does with your data</strong></summary>

Each build extracts new stories with Mozilla's [Readability](https://github.com/mozilla/readability), the same approach as Firefox's reader view, and stores the result in Cloudflare KV. Opening an article calls `/api/read`, a Cloudflare Pages Function that returns what's stored. Parsing happens in the build because it costs far more CPU than a function on the free plan is allowed per request.

- **Each article opens with the upshot.** Two to four bullets, written once by the build from the article itself, saying what happened, who's affected and what to do. Every figure in a bullet (CVE IDs, versions, dates, counts) must appear word for word in the article, or that bullet is dropped. The weekly essentials add their hand-picked "What to do" as the last line.
- **Page furniture is removed by what it is, never by who published it.** Bylines, dates, tables of contents, same-page links and "N min read" lines come out before the article is stored. If that would remove more than 35% of the text, the article is kept whole instead, because a stray byline beats a lost paragraph.
- **Article text is stored, but not in this repository.** It sits in a private KV namespace and expires after 100 days, shortly after a story leaves the site. It's a snapshot from when the story was first read, so later corrections by the publisher won't appear.
- **It says why when it can't.** Every response carries a reason: `ok`, `challenge` (the publisher blocks it), `shell`, `short`, `not_html` or `pending` (no article yet). Your screen already shows the story's summary from `data.json`, so a block never leaves it empty. Blocked stories are tried again on every build.
- **Some blocked publishers still work.** If a publisher's feed carries whole articles, the build takes the article from the feed instead.
- **It isn't a proxy.** The function never fetches anything, and only returns articles the build stored.
- **The page can't run anything from the source site.** Extracted HTML is stripped of scripts, frames, styles and event handlers during the build. It's then rendered in a sandboxed frame with no access to the page; the only script allowed in there is the site's own swipe and keyboard relay, admitted by a per-render nonce.
- **A strict Content-Security-Policy backs all of this up.** Scripts load only from the site itself, plus two inline scripts allowed by exact hash; no plugins, forms or base-URL changes; network requests go only to the site. A test keeps the hashes in step with the code.
- **No login, no tracking.** Read and New markers live in your browser's local storage and never leave it.

</details>

## Keyboard shortcuts

| Keys | Action |
| ---- | ------ |
| <kbd>⌘</kbd> <kbd>K</kbd> / <kbd>Ctrl</kbd> <kbd>K</kbd> | Search palette: type, <kbd>↑</kbd>/<kbd>↓</kbd> to choose, <kbd>Enter</kbd> to read |
| <kbd>j</kbd> / <kbd>→</kbd> | Next article (switches articles inside the reader too) |
| <kbd>k</kbd> / <kbd>←</kbd> | Previous article |
| <kbd>Enter</kbd> | Open the focused article |
| <kbd>/</kbd> | Search every article, like <kbd>⌘K</kbd> (so does clicking the search bar) |
| <kbd>Esc</kbd> | Close the palette, the reader or the shortcut list |
| <kbd>?</kbd> | Show these shortcuts |

The reader's bar shows the publisher's icon (fetched once by the build and served from the site), with buttons for text size (pick from four, remembered on your device), share and theme; the headline opens the original. On a phone, arrows at the bottom move to the previous or next story, and you can swipe right to close the reader; the feed slides back in underneath. Click an article's headline in the reader to open the original.

## Quick Start

Run the pipeline locally (it writes real data, so don't commit a local run's output unless you mean to):

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
.venv/bin/pytest -q
CLAUDE_CODE_OAUTH_TOKEN=... .venv/bin/python build.py   # needs the Claude Code CLI (npm i -g @anthropic-ai/claude-code)
```

Then serve the site. The reader needs the Pages runtime, so use Wrangler rather than a plain static server:

```bash
npm ci
node --test 'tests/*.test.js'
npx wrangler pages dev site
```

<details>
  <summary><strong>Running the browser smoke test</strong></summary>

With `npx wrangler pages dev site` running (it serves on port 8788 by default):

```bash
.venv/bin/pip install playwright && .venv/bin/python -m playwright install chromium
SMOKE_URL=http://127.0.0.1:8788 .venv/bin/pytest -q tests/test_smoke.py
```

If you change the theme script in `index.html` or the relay script in `app.js`, `node --test` prints the new hash to put in `site/_headers`.

</details>

<details>
  <summary><strong>Adding or removing feeds</strong></summary>

Edit [`feeds.opml`](feeds.opml); each feed is one `<outline>` line, and its `text` attribute is the publisher name shown on the site. Some big publishers (Anthropic, Cohere, Reuters) don't publish RSS. Anthropic, Cohere and a few others come from community-maintained feeds, and the Hacker News 300+ feed catches most of the rest. A new feed also needs a test page; see [adding a feed](#adding-a-feed).

</details>

<details>
  <summary><strong>Filling in history</strong></summary>

Run the Build workflow by hand with `backfill_days` set (say, 30). It looks back that far once, taking more entries per feed than a normal run. Everything already seen is skipped, so it's safe to rerun. Feeds only list their latest posts, though, so a backfill can only reach as far back as each feed still goes.

</details>

## Run your own copy

Everything runs on GitHub Actions and Cloudflare Pages' free tiers. The only paid piece is a Claude subscription (Pro or Max), which the build uses through the Claude Code CLI, so there's no API key and no per-token bill. Setup takes about fifteen minutes.

1. **Fork the repository.** GitHub turns workflows off in new forks, so open the fork's **Actions** tab and enable them.
2. **Create the Claude token.** On a machine where you're signed in to Claude Code with your subscription, run:

   ```bash
   claude setup-token
   ```

   It prints a long-lived OAuth token (it lasts about a year). In the fork, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `CLAUDE_CODE_OAUTH_TOKEN`, and paste the token. When it expires, builds start failing with "every scoring call failed"; run `claude setup-token` again and replace the secret.
3. **Connect Cloudflare Pages.** Create a Pages project from your fork with production branch `main`, build command `npm ci`, and output directory `site`. Add a custom domain if you want one; the `*.pages.dev` address works as is.
4. **Tell the build where the site lives.** Under **Settings → Secrets and variables → Actions → Variables**, add `SITE_URL` with your site's address (for example `https://news.example.com`). The build uses it for the RSS feed's links and to look up reading times through the site's reader.
5. **Make it yours.** Point the GitHub links and the stale-build link in `site/index.html` at your fork, change the README badges, edit [`feeds.opml`](feeds.opml) (see [adding a feed](#adding-a-feed)), and adjust the bars in [`build.py`](build.py) if you want more or fewer stories (see [Configuration](#configuration)).
6. **Give the reader somewhere to keep articles.** In Cloudflare, create a Workers KV namespace and bind it to the Pages project as `ARTICLES`, for both Production and Preview. Create an API token with only the **Workers KV Storage: Edit** permission, then add `CF_API_TOKEN`, `CF_ACCOUNT_ID` and `CF_KV_NAMESPACE_ID` as repository secrets. Without them the digest still works, but the reader only shows each story's summary.
7. **Run the first build.** Under **Actions → Build → Run workflow**, start it on `main`. Set `backfill_days` to `30` to fill in the last month (only as far back as each feed still lists). Pages deploys the result a minute after the build commits.

### Adding a feed

A feed isn't added until the reader has been proven on it, so CI fails until the new feed has a test page. It only takes two commands:

```bash
node tests/fixtures/fetch.mjs "Publisher name"              # the name from feeds.opml
UPDATE_EXPECTED=1 node --test tests/fixtures.test.js        # records what the reader makes of it
```

The saved page has its article text scrambled, so no publisher's writing ends up in your repository. Check the diff of `tests/fixtures/expected.json`, then commit both. When a real page breaks the reader, save it the same way and fix the rule in `tidy()` so it keys on what the element is, never on a site's name or class.

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
  <summary><strong>Optional extras</strong></summary>

- **Renovate:** install the [Renovate app](https://github.com/apps/renovate) on the fork; [`renovate.json`](renovate.json) is already set up.
- **Feed health:** one "Feed health" issue lists feeds that have failed every fetch for two weeks, feeds that load but have no readable dates or no post in 45 days, and feeds that permanently redirect (with the new address). For failing and quiet feeds it suggests any feeds the publisher's homepage advertises. It updates every build and closes itself when all feeds are healthy; no other setup needed.

</details>

## CI/CD

| Workflow | Function | PR | Manual | Scheduled | Details |
| -------- | -------- | :-: | :----: | :-------: | ------- |
| [Build](./.github/workflows/build.yml) | Fetch, score, publish | ✓ | ✓ | ✓ | Every 4 hours at :17 UTC. On PRs it runs the Python and JavaScript tests only. Manual runs take an optional `backfill_days`. |
| [Build › smoke](./.github/workflows/build.yml) | Browser smoke test | ✓ | | | Loads the site in Chromium under its real CSP and checks the feed, reader, search palette and swipe-back. Fails on any CSP violation, console error or page error. |

[Renovate](https://docs.renovatebot.com/) ([`renovate.json`](renovate.json)) keeps every pin current: the GitHub Actions (pinned to commit digests), `feedparser`, Readability and linkedom, and the Playwright and Wrangler versions in the smoke job. New releases wait three days before an update is proposed. Patch and digest updates merge themselves once CI passes, including the browser smoke test; minor and major updates wait for review.

Cloudflare Pages deploys every push to `main`, including the bot's data commits, and builds a preview for every PR. Its build command is `npm ci` with `site` as the output directory. The only secret is `CLAUDE_CODE_OAUTH_TOKEN`, a subscription token from `claude setup-token` (it lasts about a year), in the repo's Actions secrets. Scheduled and manual builds install the pinned Claude Code CLI to use it.

## Configuration

The knobs live at the top of [`build.py`](build.py):

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `MIN_RELEVANCE` | 8 for Security and Regulation, 7 for Other, 6 for the rest | Score a story needs to be kept |
| `CATEGORY_MAX` | 2 for AI and Security, 1 for Architecture and SDLC | Stories per day, to keep the mix balanced |
| `NEWS_SOURCES` | Six outlets | Lose ties to, and get replaced by, the original source |
| `DAILY_MAX` | 10 | Safety cap for unusually big news days |
| `DEDUPE_DAYS` | 7 | How far back to look for repeat coverage |
| `FRESH_DAYS` | 3 | Ignore feed entries older than this (env-overridable) |
| `PER_FEED` | 10 | Newest entries taken per feed per run (env-overridable) |
| `KEEP_DAYS` | 90 | Prune articles and seen URLs older than this |
| `DEAD_AFTER_DAYS` | 14 | Days of failures before a feed is reported |
| `UPSHOT_MODEL` | `claude-haiku-5-5` | Model used for scoring, repeats and the weekly picks (env). The build fails if the CLI answers with a different model |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI (env) |
| `SITE_TZ` | `America/New_York` | The time zone stories are dated in and "Today" means, on every device (env; set as a repo variable in forks) |
| `SITE_URL` | `https://upshot.levine.io` | The site's address, for the feeds' links (env; set as a repo variable in forks) |

How often it runs is the `cron` line in [`build.yml`](.github/workflows/build.yml).

## Credits

- [watch.edebost.com](https://watch.edebost.com/) — the inspiration, design language and palette
- [Mozilla Readability](https://github.com/mozilla/readability) and [linkedom](https://github.com/WebReflection/linkedom) — article extraction
- [feedparser](https://github.com/kurtmckee/feedparser) — making sense of every feed format there is
