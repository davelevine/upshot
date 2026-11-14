# Feeds

The feed list is the one part of Upshot you'll probably keep changing. This page covers adding a feed (and proving the reader works on it), backfilling its older posts, and what to do when the build flags a story as exploited when it shouldn't have.

## Adding a feed

Edit [`feeds.opml`](../../feeds.opml). Each feed is one `<outline>` line, and its `text` attribute is the publisher name shown on the site.

Some big publishers (Anthropic, Cohere, Reuters) don't publish RSS at all. Anthropic, Cohere and a few others come from community-maintained feeds, and the Hacker News 300+ feed catches most of the rest. Stories from that feed show the linked site's domain rather than the feed's name.

### Proving the reader on it

I don't consider a feed added until the reader has been proven on it, so CI fails until the new feed has a test page. It takes two commands:

```bash
node tests/fixtures/fetch.mjs "Publisher name"              # the name from feeds.opml
UPDATE_EXPECTED=1 node --test tests/fixtures.test.js        # records what the reader makes of it
```

The saved page has its article text scrambled, so no publisher's writing ends up in your repository. Check the diff of `tests/fixtures/expected.json`, then commit both.

## Backfilling

Builds only look back three days, so a new feed's older posts are never considered unless you ask. Under **Actions → Build → Run workflow**, set `backfill_days` to `30`. Only stories the build hasn't seen before are scored, so the rest of the site is untouched.

The same run fills in history for a new fork. Everything already seen is skipped, so it's safe to rerun.

## Retracting a wrong flag

The build flags a story **Exploited** or **Compromised** from CISA's catalog or from what the article says, checked against a quote (the full rules are in [Exploited flags](../architecture/exploited-flags.md)). It's careful, but it isn't perfect. Every so often a trend piece gets read as an attack.

When that happens, add the story's URL to [`not-exploited.txt`](../../not-exploited.txt), one per line. The next build drops the flag from the site and never sets it again.

Each build's run summary counts the flags, so if a run of wrong ones starts showing up, that's where you'll see it.
