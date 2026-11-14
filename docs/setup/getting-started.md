# Running your own copy

Everything runs on the free tiers of GitHub Actions and Cloudflare Workers. The only paid piece is a Claude subscription (Pro or Max), which the build uses through the Claude Code CLI, so there's no API key or per-token bill.

Setup takes about fifteen minutes. After that, the build runs every hour on its own.

## Setup

1. **Fork the repository.** GitHub turns workflows off in new forks, so open the fork's **Actions** tab and enable them.

2. **Create the Claude token.** On a machine where you're signed in to Claude Code with your subscription, run:

   ```bash
   claude setup-token
   ```

   It prints a long-lived OAuth token that lasts about a year. In the fork, go to **Settings → Secrets and variables → Actions → New repository secret**, name it `CLAUDE_CODE_OAUTH_TOKEN`, and paste the token in.

   When it eventually expires, builds start failing with "every scoring call failed". Run `claude setup-token` again and replace the secret.

3. **Give the reader somewhere to keep articles.** Do this before connecting Cloudflare; otherwise the first deploy points at someone else's namespace.

   In Cloudflare, create a Workers KV namespace and put its ID in both `kv_namespaces` entries in [`wrangler.jsonc`](../../wrangler.jsonc). The namespace ID isn't a secret, so it's fine in the repo.

   Then create an API token with two permissions:

   - **Workers KV Storage: Edit**, which lets the build store articles.
   - **Workers Scripts: Edit**, which lets GitHub Actions deploy `upshot-sync` (step 4).

   Add `CF_API_TOKEN`, `CF_ACCOUNT_ID` and `CF_KV_NAMESPACE_ID` as repository secrets.

   Without these the digest still works, but the reader only shows each story's summary.

4. **Connect Cloudflare Workers.** In [`wrangler.jsonc`](../../wrangler.jsonc), change `routes` to your own domain, or delete it and set `workers_dev` to `true` to use the `workers.dev` address.

   The site's Worker binds to a second one, `upshot-sync` ([`sync/`](../../sync/)), which handles read-state sync, so that one has to exist first. It deploys from GitHub Actions ([Deploy sync](../../.github/workflows/deploy-sync.yml)) whenever a push to `main` changes `sync/` or the npm packages, using the `CF_API_TOKEN` and `CF_ACCOUNT_ID` secrets from step 3. Run **Actions → Deploy sync → Run workflow** once, so `upshot-sync` is there before the site's Worker deploys.

   Then, in Cloudflare, go to **Workers & Pages → Create → Import a repository**, pick your fork, and name the Worker `upshot`. The name has to match `name` in `wrangler.jsonc`. Leave the build command empty and the deploy and preview commands at their defaults.

5. **Tell the build where the site lives.** Under **Settings → Secrets and variables → Actions → Variables**, add `SITE_URL` with your site's address, for example `https://news.example.com`. The build uses it for the RSS feed's links and to look up reading times through the site's reader.

6. **Make it yours.**

   - Point the GitHub links and the `og:url` tag in `site/index.html` at your fork and site.
   - Change the README badges.
   - Edit [`feeds.opml`](../../feeds.opml) (see [Feeds](feeds.md)).
   - Adjust the bars in [`build.py`](../../build.py) if you want more or fewer stories (see [Configuration](configuration.md)).

7. **Run the first build.** Under **Actions → Build → Run workflow**, start it on `main`. Set `backfill_days` to `30` to fill in the last month; a backfill only reaches as far back as each feed still lists. Cloudflare deploys the result a minute after the build commits.

## What's next

- [Feeds](feeds.md): adding a feed, backfilling, and retracting a wrong flag.
- [Configuration](configuration.md): the settings in `build.py`, and making sure the hourly schedule actually runs on time.
- [Optional extras](optional.md): the licensed fonts, Renovate, and a few notes on read-state sync.
