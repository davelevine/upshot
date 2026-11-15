# Running your own copy

Everything runs on the free tiers of GitHub Actions and Cloudflare Workers. The only paid piece is a Claude subscription (Pro or Max), which the build uses through the Claude Code CLI, so there's no API key or per-token bill. Setup takes about fifteen minutes.

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

## Next

- [Configuration](configuration.md): settings, keeping the hourly schedule on time, feeds, fonts and Renovate.
- [Hosting](../architecture/hosting.md): deploys, workflows and secrets.
