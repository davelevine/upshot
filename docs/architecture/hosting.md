# Hosting

Upshot is served by Cloudflare Workers and built and deployed from GitHub. This page explains how the site's Worker is set up, how a change reaches production, and how failures show up.

## The Worker

[`worker.js`](../../worker.js) serves the static files from `site/`, answers `/api/read` from KV, passes `/api/sync` and `/api/auth/*` to `upshot-sync`, and starts the build on a cron trigger ([Configuration](../setup/configuration.md)). Pages get a per-request CSP nonce. [`wrangler.jsonc`](../../wrangler.jsonc) sets the `ARTICLES` KV binding, the `FONTS` R2 binding, the `SYNC` service binding, the custom domain, and Workers Logs.

### Caching

Pages and `data.json` are revalidated on every load, so a deploy or a new build shows at once; `index.html`'s inline script starts the `data.json` request before `app.js` has loaded. `app.js` is loaded as `/app.js?v=<hash>` and kept for a year, so a repeat visit doesn't ask for it at all: [`tests/assets.test.js`](../../tests/assets.test.js) fails until `index.html` carries the hash of the current file, and names the value. Icons are kept a day, the licensed fonts a year (a changed font gets a new name), and a stored article a day.

## Audio

Listen's audio, which the Audio workflow makes ([The pipeline](pipeline.md#audio)), is served straight from a public R2 bucket, `upshot-audio`, on its own domain, `audio.upshot.me`. The Worker never touches it. The account is on the free Workers plan, whose 100,000 requests a day are shared by the whole site, so audio through the Worker could use them up and take the site down until midnight UTC; straight from R2, the worst case is a small bill.

- **Reads.** R2 allows 10 million reads a month for free, and downloads are always free.
- **Caching.** A cache rule caches everything on the audio domain. Each story's files are sent with a year's `immutable` Cache-Control and never overwritten, so repeat listens rarely reach R2. The index, which changes as stories are voiced, is cached for five minutes.
- **Abuse.** A WAF rule blocks any request to the audio domain with a query string, or with a method other than GET and HEAD, so the cache can't be bypassed by varying the address.
- **Storage.** A lifecycle rule deletes objects 100 days after upload, as KV expires article text. The 20-story daily cap and the 20-minute reading cap keep storage under R2's free 10 GB in practice.
- **Spending.** R2 has no spending cap, so a usage-based billing notification is set for R2.
- **CORS.** The bucket allows GET from the site's origin, for the page to read a story's timings.

## Deploys

- **The site.** Cloudflare Workers Builds deploys every push to `main`, including the build's data commits, and builds a preview for every other branch, with its URL on the PR.
- **`upshot-sync`.** Deployed by GitHub Actions when a push to `main` changes `sync/` or the npm packages, after sync's unit tests pass. Cloudflare makes no previews for a Worker with a Durable Object, which is why sync is a separate Worker. Previews share the live `upshot-sync`, but session cookies belong to the host that set them, so a preview's syncs stay apart from the live site's.

## Workflows

| Workflow | Runs on | What it does |
| -------- | ------- | ------------ |
| [Build](../../.github/workflows/build.yml) | Hourly, manual, PRs | Fetches, scores and publishes. On PRs it runs the Python and JavaScript tests only. Manual runs take an optional `backfill_days`. |
| Build › smoke | PRs | The browser smoke test against `wrangler dev` ([Development](../development.md)). |
| [Deploy sync](../../.github/workflows/deploy-sync.yml) | Push to `main`, manual | Runs sync's unit tests, then `wrangler deploy -c sync/wrangler.jsonc`. |
| [Audio](../../.github/workflows/audio.yml) | After each build, manual, PRs | Voices stories without audio and uploads them to the audio bucket. Manual runs take an optional `budget_minutes`, for a backfill. On PRs that change it, a dry run voices two stories and uploads nothing. Runs only when `AUDIO_URL` is set. |

## Secrets

Repository secrets: `CLAUDE_CODE_OAUTH_TOKEN` for scoring with Claude, and `CF_API_TOKEN`, `CF_ACCOUNT_ID` and `CF_KV_NAMESPACE_ID` for storing articles, deploying sync and uploading audio. [Getting started](../setup/getting-started.md) covers creating and renewing them. The repository variable `AUDIO_URL` is the audio bucket's address ([Configuration](../setup/configuration.md#audio)).

## When something breaks

- **A feed fails** for two weeks, goes quiet or moves: it lands in a single "Feed health" issue that closes itself once fixed, with any feeds the publisher's homepage advertises.
- **Every LLM call fails:** the run exits with an error, so GitHub emails you.
- **KV is down:** stories still publish (the reader shows a fallback until a later build stores their text), and the run is marked failed after committing.
- **The Audio workflow fails:** the site is unaffected, and stories without audio have no Listen button until a later run voices them. A run cut short keeps the audio it finished.
- **The build is late:** when the data is over 105 minutes old, a bar at the foot of the list says when it last updated, with **Check again**.
