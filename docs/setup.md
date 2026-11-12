# Running your own copy

Everything runs on the free tiers of GitHub Actions and Cloudflare Workers. The only paid piece is a Claude subscription (Pro or Max), which the build uses through the Claude Code CLI, so there's no API key and no per-token bill. Setup takes about fifteen minutes.

## Setup

1. **Fork the repository.** GitHub turns workflows off in new forks, so open the fork's **Actions** tab and enable them.

2. **Create the Claude token.** On a machine where you're signed in to Claude Code with your subscription, run:

   ```bash
   claude setup-token
   ```

   It prints a long-lived OAuth token (it lasts about a year). In the fork, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `CLAUDE_CODE_OAUTH_TOKEN`, and paste the token.

   When it expires, builds start failing with "every scoring call failed"; run `claude setup-token` again and replace the secret.

3. **Give the reader somewhere to keep articles.** Do this before connecting Cloudflare, or the first deploy points at someone else's namespace.

   In Cloudflare, create a Workers KV namespace and put its ID in both `kv_namespaces` entries in [`wrangler.jsonc`](../wrangler.jsonc). The namespace ID isn't a secret. Then create an API token with only the **Workers KV Storage: Edit** permission, and add `CF_API_TOKEN`, `CF_ACCOUNT_ID` and `CF_KV_NAMESPACE_ID` as repository secrets.

   Without these the digest still works, but the reader only shows each story's summary.

4. **Connect Cloudflare Workers.** In [`wrangler.jsonc`](../wrangler.jsonc), change `routes` to your own domain, or delete it and set `workers_dev` to `true` to use the `workers.dev` address.

   In Cloudflare, go to **Workers & Pages → Create → Import a repository**, pick your fork, and name the Worker `upshot`; it must match `name` in `wrangler.jsonc`. Leave the build command empty and the deploy and preview commands at their defaults.

5. **Tell the build where the site lives.** Under **Settings → Secrets and variables → Actions → Variables**, add `SITE_URL` with your site's address, for example `https://news.example.com`. The build uses it for the RSS feed's links and to look up reading times through the site's reader.

6. **Make it yours.** Point the GitHub links and the `og:url` tag in `site/index.html` at your fork and site. Change the README badges. Edit [`feeds.opml`](../feeds.opml) (see [Adding a feed](#adding-a-feed)). Adjust the bars in [`build.py`](../build.py) if you want more or fewer stories (see [Configuration](#configuration)).

7. **Run the first build.** Under **Actions → Build → Run workflow**, start it on `main`. Set `backfill_days` to `30` to fill in the last month; a backfill only reaches as far back as each feed still lists. Cloudflare deploys the result a minute after the build commits.

## Adding a feed

Edit [`feeds.opml`](../feeds.opml). Each feed is one `<outline>` line, and its `text` attribute is the publisher name shown on the site.

Some big publishers (Anthropic, Cohere, Reuters) don't publish RSS. Anthropic, Cohere and a few others come from community-maintained feeds, and the Hacker News 300+ feed catches most of the rest. Its stories show the linked site's domain rather than the feed's name.

A feed isn't added until the reader has been proven on it, so CI fails until the new feed has a test page. It takes two commands:

```bash
node tests/fixtures/fetch.mjs "Publisher name"              # the name from feeds.opml
UPDATE_EXPECTED=1 node --test tests/fixtures.test.js        # records what the reader makes of it
```

The saved page has its article text scrambled, so no publisher's writing ends up in your repository. Check the diff of `tests/fixtures/expected.json`, then commit both.

### Backfilling

Builds only look back three days, so a new feed's older posts are never considered unless you ask. Under **Actions → Build → Run workflow**, set `backfill_days` to `30`. Only stories the build hasn't seen before are scored, so the rest of the site is untouched.

The same run fills in history for a new fork. Everything already seen is skipped, so it's safe to rerun.

## Configuration

The knobs live at the top of [`build.py`](../build.py):

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

How often it runs is the `cron` line in [`build.yml`](../.github/workflows/build.yml) and in [`wrangler.jsonc`](../wrangler.jsonc) (see below).

## Keeping the schedule on time

GitHub's own scheduler often starts the workflow late and sometimes skips a slot, so the Worker starts it instead: a Cloudflare cron trigger in [`wrangler.jsonc`](../wrangler.jsonc) fires at the same times and dispatches the workflow on `main`. To turn it on in a fork:

1. Create a fine-grained personal access token limited to the fork, with **Actions: read and write**.
2. Set `BUILD_REPO` in `wrangler.jsonc` to `<you>/upshot`.
3. Store the token as a Worker secret: `npx wrangler secret put GITHUB_DISPATCH_TOKEN`.

Without the secret the cron does nothing. A failed dispatch shows as an error in Workers Logs. The built-in GitHub schedule stays in place as a fallback, and skips an hour the Worker already started (the `gate` job in `build.yml`), so the site builds once an hour, and a fork without the token still builds on GitHub's schedule. If you change the schedule, change it in all three places: `build.yml`, `wrangler.jsonc` and `BUILD_EVERY_HOURS`/`BUILD_AT_MINUTE` in [`site/app.js`](../site/app.js), along with `STALE_MINUTES` there, which marks a build as late.

## Retracting a wrong flag

The build flags a story **Exploited** or **Compromised** from CISA's catalog or from what the article says, checked against a quote. If one is wrong (a trend piece read as an attack, say), add its URL to [`not-exploited.txt`](../not-exploited.txt), one a line. The next build drops the flag from the site and never sets it again. Each build's run summary counts the flags, so a run of wrong ones shows up there.

## Optional: Renovate

Install the [Renovate app](https://github.com/apps/renovate) on the fork; [`renovate.json`](../renovate.json) is already set up.

It keeps every pin current: the GitHub Actions (pinned to commit digests), `feedparser`, Readability and linkedom, Wrangler, and the Playwright version in the smoke job. New releases wait three days before an update is proposed. Patch, digest and minor updates merge themselves once CI passes, including the browser smoke test. Major versions and the Claude Code CLI wait for review, arriving together on the 1st of each month; PR checks can't fully test the CLI, since they don't run the real build.
