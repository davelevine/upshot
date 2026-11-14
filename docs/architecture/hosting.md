# Hosting

Upshot runs on two Cloudflare Workers and a GitHub Actions job. This page covers how the site's Worker is configured, how each piece gets deployed, and what happens when something breaks.

## The Worker

[`worker.js`](../../worker.js) serves the static files and answers `/api/read` for the reader. On a cron trigger it also starts the Build workflow, since GitHub's scheduler runs late or skips slots. [Configuration](../setup/configuration.md) covers turning that on in a fork.

[`wrangler.jsonc`](../../wrangler.jsonc) holds the Worker's config:

- **Static assets** from `site/`, with `404.html` for unknown paths.
- **Code runs only where it's needed:** for `/api/read`, for `/api/sync` and `/api/auth/*` (passed to `upshot-sync`), and for pages, which get a per-request CSP nonce so Cloudflare's Bot Fight Mode script can run.
- **The `ARTICLES` KV binding**, where the reader's article text lives.
- **The `SYNC` service binding** to `upshot-sync` ([Sync](sync.md)).
- **The custom domain**, and **preview URLs** for PRs.
- **Workers Logs**, which keep a few days of the Worker's requests and errors.

## Deploys

Cloudflare Workers Builds deploys every push to `main` with `npx wrangler deploy`, including the bot's data commits. It also builds a Preview for every other branch, with its URL posted on the PR.

`upshot-sync` deploys separately, from GitHub Actions ([Deploy sync](../../.github/workflows/deploy-sync.yml)), when a push to `main` changes `sync/` or the npm packages, once sync's own unit tests pass. [CI/CD](../development/ci.md) has the full list of workflows.

## It looks after itself

I don't want to check on this every day, so the build tells me when something's wrong.

- **Feed health.** A feed that has failed for two weeks, gone quiet or moved lands in a single "Feed health" issue that closes itself once it's fixed. For failing and quiet feeds it suggests any feeds the publisher's homepage advertises.
- **The LLM is down.** A run where every LLM call fails exits with an error, so GitHub emails you.
- **KV is down.** The stories are still published (the reader shows a fallback until a later build stores their text) and the run is marked failed after committing, so you hear about it without losing the build.
- **The build is late.** When the data is more than 105 minutes old (a build due every hour is running at least 45 minutes late), a bar at the foot of the list says when it last updated, with a "Check again" button that fetches the data at once. Failed runs already email the repo's owner, so the bar is for readers and doesn't link to the build.
