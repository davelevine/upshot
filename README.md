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

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshot-dark.webp">
  <img src=".github/screenshot-light.webp" alt="Upshot on a desktop, with the topics, the list and a story open side by side, and on a phone, showing the same story with its upshot" width="900">
</picture>

</div>

<div align="center">

| Pipeline | Site | AI | Automation |
|---|---|---|---|
| [![Python](https://img.shields.io/badge/Python-%232c3e50?logo=python&logoColor=FFD43B&labelColor=2c3e50)](https://www.python.org/) [![feedparser](https://img.shields.io/badge/feedparser-%232c3e50?logo=rss&logoColor=F99B34&labelColor=2c3e50)](https://github.com/kurtmckee/feedparser) | [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-%232c3e50?logo=cloudflareworkers&logoColor=F38020&labelColor=2c3e50)](https://workers.cloudflare.com/) [![JavaScript](https://img.shields.io/badge/Vanilla%20JS-%232c3e50?logo=javascript&logoColor=F7DF1E&labelColor=2c3e50)](https://developer.mozilla.org/en-US/docs/Web/JavaScript) [![Readability](https://img.shields.io/badge/Readability-%232c3e50?logo=firefoxbrowser&logoColor=FF7139&labelColor=2c3e50)](https://github.com/mozilla/readability) | [![Claude](https://img.shields.io/badge/Claude%20Haiku-%232c3e50?logo=claude&logoColor=D97757&labelColor=2c3e50)](https://www.anthropic.com/claude) | [![GitHub Actions](https://img.shields.io/badge/Actions-%232c3e50?logo=githubactions&logoColor=2088FF&labelColor=2c3e50)](https://github.com/features/actions) |

</div>

Upshot is a news digest for AI, security, infrastructure, software engineering and tech regulation. I wanted to keep up with all of it without reading every feed myself, so I built something that does the first pass for me. It reads a curated list of feeds, has an LLM keep only the stories worth reading, sums each one up in a sentence, and picks five essentials for the week, each with what to do about it. The idea, and a fair bit of the design, came from [watch.edebost.com](https://watch.edebost.com/).

There's no server or database to look after, which was a big part of the appeal for me. A scheduled GitHub Actions job commits a small JSON file, and a static page renders it. Everything runs on the free tiers of GitHub Actions and Cloudflare Workers, plus a Claude subscription.

## What it does

- **It stays quiet unless there's news.** On a big day you'll see a handful of stories, and on a slow day there might not be any. Each one shows its source's icon, a one-line summary and how long ago it was published. Topics sit in a sidebar, and there's search.
- **Exploited flaws stand out.** A story about a flaw under active attack is tagged **Exploited**, with whether a patch is out, and a supply-chain attack is tagged **Compromised**. Every flag is backed by CISA's catalog or by the article itself, and the last week's get their own list under the essentials.
- **The week's essentials.** Five picks from the last seven days, each with what to do about it. They have their own entry beside the topics, and they're marked wherever they show up in the feed.
- **A built-in reader.** Articles open in a clean pane that starts with the upshot: a few bullets on what happened, who's affected and what to do. On a wide screen the pane sits beside the list, like a desktop feed reader.
- **It remembers where you were.** Unread stories stand out and read ones are dimmed. You can mark a whole list read, or everything above or below a story, the same way you would in a feed reader. None of it leaves your browser unless you turn on sync.
- **Sync, if you want it.** Generate a sync code on one device, then enter it on another or scan its QR code with your phone, and what you've read stays the same on both. There's no account, email or password, and changes show up as they happen.
- **It works on whatever you're using.** On a phone, you can swipe around and install it as an app. On a desktop, `⌘K` searches and `j`/`k` moves through the list (`?` lists the shortcuts). There are light and dark themes, and an RSS feed.

## How it works

Every hour, [`build.py`](build.py) fetches the feeds in [`feeds.opml`](feeds.opml) and sends each new story to Claude Haiku, which gives it a category, a relevance score and a one-sentence summary. I send each story on its own rather than in a batch, so its score never depends on what it happened to be grouped with. Stories that clear their category's bar and aren't repeats get published, and once a day the model picks the week's five essentials.

The build also pulls each article's text with Mozilla's Readability and stores it in Cloudflare KV. I did it this way so the reader never has to fetch anything from a publisher, and nothing from the source page ever runs.

The front end is just [`site/index.html`](site/index.html) and [`site/app.js`](site/app.js), with no framework and no build step. A Cloudflare Worker serves it and answers the reader's requests, and a second one, in [`sync/`](sync/), keeps what you've read in step across your devices.

If you want more detail, the [docs](docs/README.md) cover all of it. The **[overview](docs/architecture/overview.md)** is a good place to start, or you can jump straight to the [pipeline](docs/architecture/pipeline.md), the [reader and its security model](docs/architecture/reader.md), or [sync](docs/architecture/sync.md).

## Running your own copy

If you'd like your own, setup takes about fifteen minutes. The only paid piece is a Claude subscription (Pro or Max). The build uses it through the Claude Code CLI, so there's no API key to manage and no per-token bill. You'll fork the repo, add a Claude token and a few Cloudflare secrets, connect the fork to Cloudflare Workers, and run the first build.

**[Getting started](docs/setup/getting-started.md)** walks through each step. Once it's up and running, [feeds](docs/setup/feeds.md) covers adding your own, [configuration](docs/setup/configuration.md) covers the settings and keeping the schedule on time, and [optional extras](docs/setup/optional.md) covers the fonts and Renovate.

## Developing

These four commands set up the environment, run the unit tests and serve the site locally:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
.venv/bin/pytest -q
npm ci && node --test 'tests/*.test.js'
npx wrangler dev -c wrangler.jsonc -c sync/wrangler.jsonc --infer-origin-from-routes=false --port 8788
```

There's more on [running locally](docs/development/local.md), [testing](docs/development/testing.md) (including the browser smoke test and reader fixtures) and [CI/CD](docs/development/ci.md) in the docs.

## Built With Claude

This project was built using AI-assisted development with [Claude](https://claude.ai). I told it what to build and then said "no, not like that" a lot. The AI did a lot of typing. Commits with substantial AI contributions are marked with `Co-authored-by` tags because we're not going to pretend otherwise.

## Credits

- [watch.edebost.com](https://watch.edebost.com/) — the inspiration, design language and palette
- [Mozilla Readability](https://github.com/mozilla/readability) and [linkedom](https://github.com/WebReflection/linkedom) — article extraction
- [feedparser](https://github.com/kurtmckee/feedparser) — making sense of every feed format there is
