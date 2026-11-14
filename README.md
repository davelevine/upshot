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

Upshot is a news digest for AI, security, infrastructure, software engineering and tech regulation. I wanted to keep up with all of it without reading every feed myself, so I built something that does the first pass for me. It reads a curated list of feeds, keeps only the stories worth reading, sums each one up in a sentence, and picks five weekly essentials with what to do about each. It's inspired by [watch.edebost.com](https://watch.edebost.com/).

There's no server or database. A scheduled GitHub Actions job commits a small JSON file, and a static page renders it. It runs on the free tiers of GitHub Actions and Cloudflare Workers, plus a Claude subscription.

## Features

- **Only what matters.** A handful of stories on a big day, none on a slow one. Each shows its source, a one-line summary and its age, with topics in a sidebar and search.
- **Exploited flaws flagged.** Flaws under active attack are tagged **Exploited**, with whether a patch is out; supply-chain attacks are tagged **Compromised**. Each flag is confirmed by CISA's catalog or by the article itself.
- **Weekly essentials.** Five picks from the last seven days, each with what to do about it.
- **Built-in reader.** Articles open in a clean pane that starts with the upshot: what happened, who's affected and what to do.
- **Read state.** Unread stories stand out and read ones are dimmed. Mark a whole list read, or everything above or below a story. It stays in your browser unless you turn on sync.
- **Sync.** Pair devices with a sync code or QR code. No account, email or password.
- **Phone and desktop.** Swipe navigation and install as an app on a phone; `⌘K` search and `j`/`k` navigation on a desktop. Light and dark themes, and an RSS feed.

## How it works

1. Every hour, [`build.py`](build.py) fetches the feeds in [`feeds.opml`](feeds.opml).
2. Each new story goes to Claude Haiku on its own (so its score never depends on what it was batched with) for a category, a relevance score and a one-sentence summary.
3. Stories that clear their category's bar and aren't repeats are published. Once a day, the model picks the week's five essentials.
4. Each article's text is extracted with Mozilla's Readability and stored in Cloudflare KV, so the reader never fetches from publishers and nothing from the source page runs.

The front end is [`site/index.html`](site/index.html) and [`site/app.js`](site/app.js), with no framework or build step. A Cloudflare Worker serves it and answers the reader's requests; a second Worker, in [`sync/`](sync/), handles sync.

See the [docs](docs/README.md) for the rest, starting with the [overview](docs/architecture/overview.md).

## Running your own copy

Setup takes about fifteen minutes. The only paid piece is a Claude subscription (Pro or Max), used through the Claude Code CLI, so there's no API key or per-token bill.

- [Getting started](docs/setup/getting-started.md): fork, add the secrets, connect Cloudflare and run the first build
- [Feeds](docs/setup/feeds.md): adding feeds and backfilling
- [Configuration](docs/setup/configuration.md): settings and the build schedule
- [Optional extras](docs/setup/optional.md): fonts and Renovate

## Developing

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
.venv/bin/pytest -q
npm ci && node --test 'tests/*.test.js'
npx wrangler dev -c wrangler.jsonc -c sync/wrangler.jsonc --infer-origin-from-routes=false --port 8788
```

More in [running locally](docs/development/local.md), [testing](docs/development/testing.md) and [CI/CD](docs/development/ci.md).

## Built With Claude

This project was built using AI-assisted development with [Claude](https://claude.ai). I told it what to build and then said "no, not like that" a lot. The AI did a lot of typing. Commits with substantial AI contributions are marked with `Co-authored-by` tags because we're not going to pretend otherwise.

## Credits

- [watch.edebost.com](https://watch.edebost.com/) — the inspiration, design language and palette
- [Mozilla Readability](https://github.com/mozilla/readability) and [linkedom](https://github.com/WebReflection/linkedom) — article extraction
- [feedparser](https://github.com/kurtmckee/feedparser) — making sense of every feed format there is
