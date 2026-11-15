# Configuration

A fork runs fine on the defaults. This page is for changing them: how many stories get through, when the build runs, which feeds it reads, and the optional fonts.

## Settings

Constants at the top of [`build.py`](../../build.py); the defaults are what the live site runs. "env" means an environment variable can override it.

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `MIN_RELEVANCE` | 8 for Security and Regulation, 7 for AI and Other, 6 for Infrastructure and Engineering | Score a story needs to be published |
| `NEWS_SOURCES` | Six outlets | Lose ties to the original source |
| `DAILY_MAX` | 20 | Daily cap, set to catch a malfunction |
| `DEDUPE_DAYS` | 7 | Days to look back for repeats |
| `FRESH_DAYS` | 3 | Ignore older entries (env) |
| `PER_FEED` | 10 | Entries per feed per run (env) |
| `KEEP_DAYS` | 90 | Days before pruning |
| `DEAD_AFTER_DAYS` | 14 | Days of failures before a feed is reported |
| `UPSHOT_MODEL` | `claude-haiku-5-5` | Model for all calls (env); the build fails if the CLI answers with another |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI (env) |
| `SITE_TZ` | `America/New_York` | Time zone for dates and "Today" (env) |
| `SITE_URL` | `https://upshot.levine.io` | The site's address (env) |

## Schedule

GitHub's scheduler runs late and skips slots, so a cron trigger in [`wrangler.jsonc`](../../wrangler.jsonc) dispatches the Build workflow instead. GitHub's schedule stays as a fallback and skips an hour the Worker already started (the `gate` job in `build.yml`).

To turn it on in a fork:

1. Create a fine-grained personal access token for the fork with **Actions: read and write**.
2. Set `BUILD_REPO` in `wrangler.jsonc` to `<you>/upshot`.
3. Store the token: `npx wrangler secret put GITHUB_DISPATCH_TOKEN`. In the dashboard, add it under **Settings → Variables and secrets** as a **Secret** for **Production** only; the cron never runs on a Preview.

Without the secret the cron silently does nothing (Workers Logs still say `ok`). Check that `npx wrangler secret list` lists `GITHUB_DISPATCH_TOKEN` and that a `workflow_dispatch` run appears within seconds of the cron.

To change the schedule, change it in three places: the `cron` in `build.yml`, the cron in `wrangler.jsonc`, and `BUILD_EVERY_HOURS`/`BUILD_AT_MINUTE` in [`site/app.js`](../../site/app.js), with `STALE_MINUTES` there, which marks a build as late.

## Feeds

Each feed is one `<outline>` line in [`feeds.opml`](../../feeds.opml); its `text` is the publisher name shown on the site. Publishers without RSS come from community feeds or the Hacker News 300+ feed.

CI fails until a new feed has a test page proving the reader works on it:

```bash
node tests/fixtures/fetch.mjs "Publisher name"              # the name from feeds.opml
UPDATE_EXPECTED=1 node --test tests/fixtures.test.js        # records what the reader makes of it
```

The saved page's text is scrambled. Check the diff of `tests/fixtures/expected.json` and commit both.

**Backfilling.** Builds look back three days. To pull in a new feed's older posts, or a new fork's history, run **Actions → Build → Run workflow** with `backfill_days` set to `30`. Only unseen stories are scored, so it's safe to rerun.

**Retracting a wrong flag.** Add the story's URL to [`not-exploited.txt`](../../not-exploited.txt), one per line. The next build drops its Exploited or Compromised flag and never sets it again. How flags are set is in [The pipeline](../architecture/pipeline.md).

## Fonts

Söhne, Mercury Text and Mercury Display are licensed, so a fork shows system fonts.

To use them, create a private R2 bucket named `upshot-fonts`, used for nothing else (the Worker's binding can write to all of it). Upload the `.woff2` files at the top level: `Sohne-Buch`, `Sohne-Kraftig`, `Sohne-Halbfett`, `Mercury-DisplaySemibold`, and the twelve `Mercury-TextG1…`/`Mercury-TextG2…` faces.

```bash
for f in Sohne-*.woff2 Mercury-*.woff2; do npx wrangler r2 object put "upshot-fonts/$f" --file "$f" --content-type font/woff2 --remote; done
```
