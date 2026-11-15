# Running your own copy

This guide sets up your own copy of Upshot: a fork that builds every hour on GitHub Actions and serves from Cloudflare Workers.

## Before you start

- **A GitHub account**, to fork the repository and run the build.
- **A Cloudflare account.** The Workers, KV namespace and Durable Objects Upshot uses fit in the free plan.
- **A Claude Pro or Max subscription.** The build calls Claude through the Claude Code CLI with a token from your subscription, so there's no API key or per-token bill.
- **The Claude Code CLI**, signed in to that subscription, to create the token in step 2.
- **About fifteen minutes.**

## Setup

1. **Fork the repository** and enable workflows in the fork's **Actions** tab (GitHub turns them off in new forks).

2. **Create the Claude token.** Where you're signed in to Claude Code, run:

   ```bash
   claude setup-token
   ```

   Add the token as a repository secret named `CLAUDE_CODE_OAUTH_TOKEN` (**Settings → Secrets and variables → Actions**). It lasts about a year; when builds start failing with "every scoring call failed", run it again and replace the secret.

3. **Create a Workers KV namespace** for article text, before connecting Cloudflare, so the first deploy doesn't point at someone else's. Put its ID in both `kv_namespaces` entries in [`wrangler.jsonc`](../../wrangler.jsonc); it isn't a secret.

   Create a Cloudflare API token with **Workers KV Storage: Edit** (the build stores articles) and **Workers Scripts: Edit** (Actions deploys `upshot-sync`). Add `CF_API_TOKEN`, `CF_ACCOUNT_ID` and `CF_KV_NAMESPACE_ID` as repository secrets. Without them the site still works, but the reader only shows summaries.

4. **Connect Cloudflare Workers.** In `wrangler.jsonc`, set `routes` to your domain, or delete it and set `workers_dev` to `true`.

   The site's Worker binds to `upshot-sync`, so deploy that first: **Actions → Deploy sync → Run workflow**. Then, in Cloudflare, go to **Workers & Pages → Create → Import a repository**, pick your fork, and name the Worker `upshot` (it must match `name` in `wrangler.jsonc`). Leave the build command empty and the deploy commands at their defaults.

5. **Set `SITE_URL`** as a repository variable (**Settings → Secrets and variables → Actions → Variables**), for example `https://news.example.com`. The build uses it for the RSS feed's links and reading times.

6. **Make it yours:** the GitHub links and `og:url` in `site/index.html`, the README badges, and [`feeds.opml`](../../feeds.opml).

7. **Run the first build** from **Actions → Build → Run workflow** on `main`, with `backfill_days` set to `30` to fill in the last month (as far back as each feed still lists). Cloudflare deploys a minute after the build commits.

## Check that it worked

- The Build run finishes and commits `site/data.json` and `site/rss.xml` to `main`.
- About a minute later, your site loads with the last month's stories.
- Opening a story shows the article in the reader. If it shows only the summary, check the three `CF_` secrets from step 3.

## Next

- [Configuration](configuration.md): settings, keeping the hourly schedule on time, feeds, fonts and Renovate.
- [Hosting](../architecture/hosting.md): deploys, workflows and secrets.
