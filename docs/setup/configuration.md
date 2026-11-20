# Configuration

A fork runs fine on the defaults. This page is for changing them: how many stories get through, when the build runs, which feeds it reads, and the optional fonts and audio.

## Settings

Constants at the top of [`build.py`](../../build.py); the defaults are what the live site runs. "env" means an environment variable can override it.

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `MIN_RELEVANCE` | 8 for Security, 7 for AI, Regulation and Other, 6 for Infrastructure and Engineering | Score a story needs to be published |
| `NEWS_SOURCES` | Six outlets | Lose ties to the original source |
| `DAILY_MAX` | 20 | Daily cap, set to catch a malfunction |
| `DEDUPE_DAYS` | 7 | Days to look back for repeats |
| `FRESH_DAYS` | 3 | Ignore older entries (env) |
| `PER_FEED` | 10 | Entries per feed per run (env) |
| `KEEP_DAYS` | 90 | Days before pruning |
| `DEAD_AFTER_DAYS` | 14 | Days of failures before a feed is reported |
| `SILENT_AFTER_DAYS` | 45 | Days without a post before a feed that still loads is reported |
| `MODEL` | `claude-haiku-5-5` | Model for all calls (env: `UPSHOT_MODEL`); the build fails if the CLI answers with another |
| `CLAUDE` | `claude` | Path to the Claude Code CLI (env: `CLAUDE_BIN`) |
| `SITE_TZ` | `America/New_York` | Time zone for dates and "Today" (env) |
| `SITE_URL` | `https://upshot.me` | The site's address (env) |
| `AUDIO_URL` | none | The audio bucket's address (env); see [Audio](#audio) |

## Schedule

GitHub's scheduler runs late and skips slots, so a cron trigger in [`wrangler.jsonc`](../../wrangler.jsonc) dispatches the Build workflow instead. GitHub's schedule stays as a fallback and skips an hour the Worker already started (the `gate` job in `build.yml`).

To turn it on in a fork:

1. Create a fine-grained personal access token for the fork with **Actions: read and write**.
2. Set `BUILD_REPO` in `wrangler.jsonc` to `<you>/upshot`.
3. Store the token: `npx wrangler secret put GITHUB_DISPATCH_TOKEN`. In the dashboard, add it under **Settings → Variables and secrets** as a **Secret** for **Production** only; the cron never runs on a Preview.

Without the secret the cron silently does nothing (Workers Logs still say `ok`). Check that `npx wrangler secret list` lists `GITHUB_DISPATCH_TOKEN` and that a `workflow_dispatch` run appears within seconds of the cron.

To change the schedule, change it in three places: the `cron` in `build.yml`, the cron in `wrangler.jsonc`, and `BUILD_EVERY_HOURS`/`BUILD_AT_MINUTE` in [`site/app.js`](../../site/app.js), with `STALE_MINUTES` there, which marks a build as late.

## Protecting main

A ruleset on `main` requires a pull request with passing `build` and `smoke` checks, and blocks force-pushes and deletion. The hourly data commit goes straight to `main`, so the Build workflow pushes it with a deploy key, the ruleset's only bypass. The ruleset is in [`main-ruleset.json`](main-ruleset.json).

To set it up:

1. Create a key pair: `ssh-keygen -t ed25519 -N "" -C upshot-data-push -f upshot-data-push`.
2. Add `upshot-data-push.pub` under **Settings → Deploy keys** with **Allow write access**.
3. Add the private key `upshot-data-push` as the Actions secret `DATA_PUSH_KEY`, then delete both files.
4. Import `main-ruleset.json` under **Settings → Rules → Rulesets → New ruleset → Import a ruleset**.

Without the secret, the build pushes with the workflow token, which the ruleset rejects.

## Feeds

Each feed is one `<outline>` line in [`feeds.opml`](../../feeds.opml); its `text` is the publisher name shown on the site. Publishers without RSS come from community feeds or the Hacker News 300+ feed.

CI fails until a new feed has a test page proving the reader works on it:

```bash
node tests/fixtures/fetch.mjs "Publisher name"              # the name from feeds.opml
UPDATE_EXPECTED=1 node --test tests/fixtures.test.js        # records what the reader makes of it
```

The saved page's text is scrambled. Check the diff of `tests/fixtures/expected.json` and commit it with the page and `tests/fixtures/meta.json`.

**Backfilling.** Builds look back three days. To pull in a new feed's older posts, or a new fork's history, run **Actions → Build → Run workflow** with `backfill_days` set to `30`; a backfill also reads up to 100 entries per feed instead of `PER_FEED`'s 10. Only unseen stories are scored, so it's safe to rerun.

**Retracting a wrong flag.** Add the story's URL to [`not-exploited.txt`](../../not-exploited.txt), one per line. The next build drops its Exploited or Compromised flag and never sets it again. How flags are set is in [The pipeline](../architecture/pipeline.md).

## Fonts

Söhne, Domaine Text and Domaine Display are licensed, so a fork shows system fonts. Literata and Atkinson Hyperlegible Next are open, but are served from the same bucket so no font request leaves the site; without them, those two typefaces fall back to the system's.

To use them, create a private R2 bucket named `upshot-fonts`, used for nothing else (the Worker's binding can write to all of it). Upload the `.woff2` files at the top level: `Sohne-Buch`, `Sohne-Kraftig`, `Sohne-Halbfett`, `Sohne-BuchKursiv`, `Sohne-HalbfettKursiv`, `Domaine-DisplayMedium`, `Domaine-TextRegular`, `Domaine-TextItalic`, `Domaine-TextBold` and `Domaine-TextBoldItalic`.

The open fonts are Google Fonts' latin and latin-ext subsets, each roman and italic, named `Literata-Roman-Latin`, `Literata-Roman-LatinExt`, `Literata-Italic-Latin`, `Literata-Italic-LatinExt`, and the same four for `AtkinsonNext`. Google picks files by browser, so ask as a current Chrome; the CSS lists each subset's file under a `/* latin */` or `/* latin-ext */` comment:

```bash
curl -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' \
  'https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400..700;1,7..72,400..700&family=Atkinson+Hyperlegible+Next:ital,wght@0,400..700;1,400..700'
```

Their `unicode-range` values are in `site/app.js` (`LATIN`, `LATIN_EXT`); a new download with different ranges needs them updated there.

Browsers keep each font for a year without checking it again, so never upload a changed font over an existing name: give it a new one, and update its references in `site/index.html`, `site/404.html` and `site/app.js`.

```bash
for f in Sohne-*.woff2 Domaine-*.woff2 Literata-*.woff2 AtkinsonNext-*.woff2; do npx wrangler r2 object put "upshot-fonts/$f" --file "$f" --content-type font/woff2 --remote; done
```

## Audio

Listen plays audio the Audio workflow makes ([The pipeline](../architecture/pipeline.md#audio)). A fork without it has no Listen button. To turn it on:

1. **Create the bucket.** In Cloudflare, **R2 → Create bucket**, named `upshot-audio` (the name is `BUCKET` in [`audio.py`](../../audio.py)).
2. **Give it a domain.** In the bucket's **Settings → Custom Domains**, connect a subdomain of the site's zone, for example `audio.example.com`.
3. **Expire old audio.** In **Settings → Object lifecycle rules**, delete objects 100 days after upload.
4. **Let the page read it.** In **Settings → CORS policy**, allow `GET` and `HEAD` from the site's origin.
5. **Block cache-busting.** In the zone's **Security → WAF → Custom rules**, block requests to the audio domain with a query string or another method: `(http.host eq "audio.example.com" and (http.request.uri.query ne "" or not http.request.method in {"GET" "HEAD"}))`.
6. **Cache it.** In the zone's **Caching → Cache Rules**, make everything on the audio domain eligible for cache, with the edge TTL from the origin's Cache-Control.
7. **Watch the bill.** R2 has no spending cap, so add a usage-based billing notification for R2 under **Notifications**.
8. **Let the build write to it.** Add **Workers R2 Storage: Edit** to the API token in `CF_API_TOKEN`.
9. **Let the page reach it.** Replace `https://audio.upshot.me` in `connect-src` in [`site/_headers`](../../site/_headers) with the domain, so the page can read the bucket's index and timings.
10. **Turn it on.** Set the repository variable `AUDIO_URL` to the domain, for example `https://audio.example.com`. The Audio workflow then runs after every build, and the build tells the page where the audio is.

To voice the stories already on the site, run **Actions → Audio → Run workflow** with `budget_minutes` set to `300`.

Constants at the top of `audio.py`:

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `BUDGET_MIN` | 20 | Minutes into a run after which no story starts (env: `AUDIO_BUDGET_MIN`) |
| `MAX_READING_MIN` | 20 | Longer stories get their headline and upshot only |
| `VOICE` | `af_heart` | Kokoro's voice |
| `VERSION` | 1 | The audio's format; a bump voices every story again, under new names |
