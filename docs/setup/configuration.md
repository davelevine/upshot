# Configuration

Most of Upshot's behaviour is tuned with a handful of constants at the top of `build.py`. The defaults are what I run, but they're easy to change if you want a busier or quieter site. The other thing worth setting up is the Worker's cron, since GitHub's own scheduler can't be trusted to run the build on time.

## The knobs

The knobs live at the top of [`build.py`](../../build.py):

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

How often it runs is the `cron` line in [`build.yml`](../../.github/workflows/build.yml) and in [`wrangler.jsonc`](../../wrangler.jsonc), which is covered next.

## Keeping the schedule on time

GitHub's scheduler often starts the workflow late and sometimes skips a slot entirely. For a site that promises hourly news, that wasn't good enough, so the Worker starts the build instead. A Cloudflare cron trigger in [`wrangler.jsonc`](../../wrangler.jsonc) fires at the same times and dispatches the workflow on `main`.

To turn it on in a fork:

1. Create a fine-grained personal access token limited to the fork, with **Actions: read and write**.
2. Set `BUILD_REPO` in `wrangler.jsonc` to `<you>/upshot`.
3. Store the token as a Worker secret:

   ```bash
   npx wrangler secret put GITHUB_DISPATCH_TOKEN
   ```

   If you'd rather use the dashboard, add it under **Settings → Variables and secrets** as a **Secret** for **Production** only. The cron never runs on a Preview, so a token saved there (or as a build variable) never reaches it.

### Checking it works

Here's the catch: without the secret, the cron does nothing, silently. Workers Logs still show each run as `ok`. So check it directly:

- `npx wrangler secret list` should list `GITHUB_DISPATCH_TOKEN`.
- A build should appear as a `workflow_dispatch` run within seconds of the cron.
- A failed dispatch shows as an error in Workers Logs.

The built-in GitHub schedule stays in place as a fallback, and skips an hour the Worker already started (the `gate` job in `build.yml`). So the site builds once an hour either way, and a fork without the token still builds on GitHub's schedule.

### Changing the schedule

If you change the schedule, change it in all three places:

- `build.yml`
- `wrangler.jsonc`
- `BUILD_EVERY_HOURS`/`BUILD_AT_MINUTE` in [`site/app.js`](../../site/app.js), along with `STALE_MINUTES` there, which marks a build as late.
