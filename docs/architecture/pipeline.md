# The pipeline

Every hour the Build workflow runs [`build.py`](../../build.py). It takes the feeds, keeps the handful of stories worth reading, and publishes them. This page walks through each step in order.

## 1. Fetch

The build reads every feed in [`feeds.opml`](../../feeds.opml). A broken feed is skipped, never fatal; one publisher having a bad day shouldn't take the whole build down with it.

## 2. Filter

It keeps dated entries from the last few days that haven't been seen before, capped per feed.

## 3. Score

Each new story goes to Claude Haiku (`claude-haiku-5-5`) on its own, through the Claude Code CLI on a Claude subscription. I send them one at a time on purpose, so a story's score never depends on what it was batched with.

For each story, the model returns:

- a category
- a 1-10 relevance score, judged within its category
- a one-sentence summary
- whether it reports an exploited flaw, with the words that say so

## 4. Keep the notable ones

A story is published if it clears its category's bar and isn't a repeat, or if it reports an exploited flaw (see [Exploited flags](exploited-flags.md)). The bars are:

- **8** for Security and Regulation
- **7** for AI and Other
- **6** for Infrastructure and Engineering

There are no per-category quotas, so a big security day shows as one and a slow day stays short. That's the whole point, really.

Nothing published is ever taken down. There's a 20-story daily cap, but it exists only to catch a malfunction, like a broken feed.

## 5. Drop repeats

The model flags a story that's already on the site from the past week (the same launch from another outlet, say). I don't take the model's word for it; the code checks that claim, so one copy always survives.

## 6. Flag exploited flaws

Stories about a flaw under active attack, or a supply-chain compromise, get flagged. There's enough to this step that it has [its own page](exploited-flags.md).

## 7. Pick the essentials

Once a day, the model chooses the week's five essentials.

## 8. Extract

[`extract.mjs`](../../extract.mjs) pulls each new story's text into Cloudflare KV for the reader. [The reader](reader.md) covers how that works.

## 9. Publish

The build writes [`site/data.json`](../../site/data.json) and [`site/rss.xml`](../../site/rss.xml), remembers the URLs it's seen in `state.json`, and commits. Cloudflare deploys the Worker on the push.

## Pruning

Everything older than 90 days is pruned, so the data stays small.
