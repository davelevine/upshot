# Optional extras

None of this is needed to run Upshot. The site works without the licensed fonts, Renovate is optional, and read-state sync needs no setup beyond [Getting started](getting-started.md).

## The fonts

The site is set in Söhne, Mercury Text and Mercury Display. They're licensed fonts, so they can't live in the repository, and a fork shows the system sans and serif (Iowan Old Style, Charter or Georgia) instead. Nothing else changes: `/fonts/licensed/` answers 404, which the browser console lists.

To use them, or other licensed fonts in their place, create a private R2 bucket named `upshot-fonts`. It doesn't need public access or a custom domain; the Worker serves the files.

Upload the `.woff2` files at the bucket's top level, under the names `site/index.html` and `site/app.js` ask for:

- `Sohne-Buch`, `Sohne-Kraftig` and `Sohne-Halbfett`
- `Mercury-DisplaySemibold`
- the twelve `Mercury-TextG1…`/`Mercury-TextG2…` faces (roman, italic, semibold, semibold italic, bold, bold italic)

Any of them can go up through the dashboard, or all at once:

```bash
for f in Sohne-*.woff2 Mercury-*.woff2; do npx wrangler r2 object put "upshot-fonts/$f" --file "$f" --content-type font/woff2 --remote; done
```

H&Co's Mercury files need cleaning first; [Typography](../architecture/typography.md) explains what and why.

Keep the bucket for the fonts alone. The Worker's binding can read and write everything in it.

## Renovate

Install the [Renovate app](https://github.com/apps/renovate) on the fork; [`renovate.json`](../../renovate.json) is already set up.

It keeps every pin current: the GitHub Actions (pinned to commit digests), `feedparser`, Readability and linkedom, Wrangler, and the Playwright version in the smoke job.

- **New releases wait three days** before an update is proposed.
- **Patch, digest and minor updates merge themselves** once CI passes, including the browser smoke test.
- **Major versions and the Claude Code CLI wait for review**, arriving together on the 1st of each month. PR checks can't fully test the CLI, since they don't run the real build.

## Read-state sync

Readers can turn on sync to keep what they've read in step across devices, joining each device with a short code (the design is in [Sync](../architecture/sync.md)). It runs on the Free plan. The SQLite-backed Durable Objects and two rate limits, all in [`sync/wrangler.jsonc`](../../sync/wrangler.jsonc), need no setup beyond deploying `upshot-sync` (step 4 of [Getting started](getting-started.md)), which GitHub Actions does from then on.

A couple of things worth knowing:

- **Previews.** PR previews of the site reach the same `upshot-sync`. Session cookies belong to the host that set them, so a preview's syncs are separate from the live site's and can't see its data. Changes to `sync/` itself deploy only from `main`, through Deploy sync, so try them locally first ([Local development](../development/local.md)).
- **Changing the storage.** The Durable Objects' tables are created in their constructors (`CREATE TABLE IF NOT EXISTS`). A new column needs an `ALTER TABLE` there as well, and a new Durable Object class needs a new entry in `migrations`.
