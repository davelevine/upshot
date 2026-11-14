# CI/CD

This page covers what runs on GitHub Actions, how the site and `upshot-sync` get deployed, and where the build's secrets live.

## Workflows

| Workflow | Function | PR | Manual | Scheduled | Details |
| -------- | -------- | :-: | :----: | :-------: | ------- |
| [Build](../../.github/workflows/build.yml) | Fetch, score, publish | ✓ | ✓ | ✓ | Every hour at :17 UTC, started by the Worker's cron; GitHub's own schedule is the fallback and skips an hour the Worker already started. On PRs it runs the Python and JavaScript tests only. Manual runs take an optional `backfill_days`. |
| [Build › smoke](../../.github/workflows/build.yml) | Browser smoke test | ✓ | | | The [smoke test](testing.md#the-browser-smoke-test), against `wrangler dev` in the workflow. |
| [Deploy sync](../../.github/workflows/deploy-sync.yml) | Deploy `upshot-sync` | | ✓ | | On every push to `main` that changes `sync/` or the npm packages: runs sync's unit tests, then `wrangler deploy -c sync/wrangler.jsonc`. Uses the `CF_API_TOKEN` secret, which needs **Workers Scripts: Edit** ([setup](../setup/getting-started.md), step 3). |

## Deploys

Cloudflare Workers Builds deploys every push to `main` with `npx wrangler deploy`, including the bot's data commits. It also builds a Preview for every other branch, with its URL posted on the PR.

## Secrets

The build's secrets live in the repo's Actions secrets:

- **`CLAUDE_CODE_OAUTH_TOKEN`**, from `claude setup-token`. It lasts about a year.
- **The three `CF_` secrets**, which let the build store articles in KV.

Scheduled and manual builds install the pinned Claude Code CLI to use the token.

## Dependency updates

Renovate handles dependency updates; see [Optional extras](../setup/optional.md).
