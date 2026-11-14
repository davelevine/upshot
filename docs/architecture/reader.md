# The reader, and what it does with your data

Articles open in Upshot's own pane, in its own type and theme, starting with the upshot. This page covers how the text is extracted and stored, and the rules that keep a publisher's page from running anything.

## How articles are extracted

Each build extracts new stories with Mozilla's [Readability](https://github.com/mozilla/readability), the same approach as Firefox's reader view, and stores the result in Cloudflare KV. Opening an article calls `/api/read`, which the Worker answers with what's stored.

I do the parsing in the build rather than in the Worker because it costs far more CPU than the Worker is allowed per request on the free plan.

The fonts the reader uses, and how they reach the frame, are on [their own page](typography.md).

## What the reader promises

- **Each article opens with the upshot.** Two to four bullets, written once by the build from the article itself. Every figure in a bullet (CVE IDs, versions, dates, counts) must appear word for word in the article, or that bullet is dropped. The weekly essentials add their hand-picked "What to do" as the last line.
- **Page furniture is removed by what it is, never by who published it.** Bylines, dates, tables of contents, same-page links and "N min read" lines come out before the article is stored. If that would remove more than 35% of the text, the article is kept whole instead, because a stray byline beats a lost paragraph.
- **Article text is stored, but not in this repository.** It sits in a private KV namespace and expires after 100 days, shortly after a story leaves the site. It's a snapshot from when the story was first read, so later corrections by the publisher won't appear.
- **It says why when it can't.** Every response carries a reason: `ok`, `challenge` (the publisher blocks it), `shell`, `short`, `not_html` or `pending` (no article yet). The page already shows the story's summary from `data.json`, so a block never leaves it empty. Whatever the reason, a story without an article shows its summary and a link to the original. The reader never frames another site's page, so every story it shows is in Upshot's own type and theme. Blocked stories are tried again on every build, and if a blocked publisher's feed carries whole articles, the build takes the article from the feed instead.
- **It isn't a proxy.** The Worker never fetches anything, and only returns articles the build stored.
- **The page can't run anything from the source site.** Extracted HTML is stripped of scripts, frames, styles and event handlers during the build, then rendered in a sandboxed frame with no access to the page. The only script allowed in there is the site's own swipe and keyboard relay, admitted by a per-render nonce.
- **A strict Content-Security-Policy backs all of this up.** Scripts load only from the site itself, plus two inline scripts allowed by exact hash; no plugins, forms or base-URL changes; network requests go only to the site. A test keeps the hashes in step with the code.
- **No login, no tracking.** What you've read lives in your browser's local storage, and leaves it only if you turn on [sync](sync.md).
