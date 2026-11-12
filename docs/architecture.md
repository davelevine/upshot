# Architecture

How a story gets from a publisher's feed to the page, and what the reader does with it.

## The pipeline

Every four hours the Build workflow runs [`build.py`](../build.py):

1. **Fetch:** reads every feed in [`feeds.opml`](../feeds.opml). A broken feed is skipped, never fatal.
2. **Filter:** keeps dated entries from the last few days that haven't been seen before, capped per feed.
3. **Score:** sends each new story to Claude Haiku (`claude-haiku-5-5`) on its own, through the Claude Code CLI on a Claude subscription, so a story's score never depends on what it was batched with. Each gets a category, a 1-10 relevance score judged within its category, and a one-sentence summary.
4. **Keep the notable ones:** a story is published if it clears its category's bar (8 for Security and Regulation, 7 for AI and Other, 6 for Infrastructure and Engineering) and isn't a repeat. There are no per-category quotas, so a big security day shows as one and a slow day stays short. Nothing published is ever taken down; a 20-story daily cap exists only to catch a malfunction, like a broken feed.
5. **Drop repeats:** the model flags a story that's already on the site from the past week (the same launch from another outlet, say). The code checks that claim, so one copy always survives.
6. **Pick the essentials:** once a day, the model chooses the week's five.
7. **Extract:** [`extract.mjs`](../extract.mjs) pulls each new story's text into Cloudflare KV for the reader (see below).
8. **Publish:** writes [`site/data.json`](../site/data.json) and [`site/rss.xml`](../site/rss.xml), remembers seen URLs in `state.json`, commits, and Cloudflare deploys the Worker on the push.

Everything older than 90 days is pruned, so the data stays small.

## The site

[`site/index.html`](../site/index.html) and [`site/app.js`](../site/app.js) are the whole front end: no framework, no build step.

The layout follows desktop feed readers such as Feedbin, in three widths:

- **Phones (up to 640px):** pages, as in Feedbin's app. Upshot opens on the topics; picking one opens its list, with a back chevron and its name in the header, and a story covers the list. Each page slides over the one before and follows the finger when swiped. Back, the chevron and a swipe right step back through them; a swipe left goes forward again, into the list just left or the story just closed. Articles read once are kept for the visit, so reopening one is instant.
- **641–1023px:** the reader docked on the right, as from 1024px, and the topics and the list as two pages of one left pane, scrolled sideways, as in Feedbin. Upshot opens on the list, and picking a topic slides to its list. The pane narrows (to 280px at 641px) so the article keeps at least 360px.
- **1024px and up:** sidebar, list and reader side by side. Dragging the sidebar's or the list's edge resizes it; the widths are kept in the browser, and a double-click resets them.

From 641px there is no full-width header: the logo tops the left pane, and the menu sits at the end of the reader bar. The reader stays docked, the list scrolls on its own, and it stays live while an article is open, so `j`/`k` and clicks move through it.

The essentials are an entry in the topics, not a separate section, so no story is listed twice.

Lists run newest first, by the age each row shows; stories of the same age keep the build's order, most relevant first. The sidebar counts unread stories, as a feed reader does. A first visit starts with the last day's stories unread, or the newest five after a quiet stretch, and older ones show as read; after that, anything added since counts. The week's essentials count as unread until opened, however old. An older story marked unread by hand stays unread. A toolbar after Feedbin's holds two buttons, each centred in half of it: at the sidebar's foot from 1024px (the pane's below that), **Shortcuts** and **Read**; on a phone, a list's bottom bar with **Top** (back to the top, dimmed when there) and **Read**. Read marks the list that's showing read once confirmed (`Shift A` too), and the `…` on the selected story (the one open, or on a phone the one just closed) marks the stories above or below it. Bulk marks go in at the oldest end of the read list, so the search panel's "Recently read" still starts with what was opened.

Each time Upshot opens, or comes back after 15 minutes away (but not on a refresh or a new tab within 15 minutes of the last pass), the wordmark shows for a moment, then its spot runs once through the date, when the news last updated and when the next build is due (from the build's schedule, `17 */4 * * *` UTC, and left out when a build is late), then settles back on the wordmark, after Kagi News. The pass takes under five seconds, so it needs no pause control under WCAG 2.2.2, and a tap ends it. [`site/_headers`](../site/_headers) sets the Content-Security-Policy. [`worker.js`](../worker.js) serves the static files and answers `/api/read` for the reader, and on a cron trigger starts the Build workflow, since GitHub's scheduler runs late or skips slots; [`wrangler.jsonc`](../wrangler.jsonc) configures the Worker.

## The reader, and what it does with your data

Each build extracts new stories with Mozilla's [Readability](https://github.com/mozilla/readability), the same approach as Firefox's reader view, and stores the result in Cloudflare KV. Opening an article calls `/api/read`, which the Worker answers with what's stored. Parsing happens in the build because it costs far more CPU than the Worker is allowed per request on the free plan.

Articles are set in Literata, with headings and the rest of the site in Public Sans; both are self-hosted under `site/fonts/` (Latin only, OFL). The reader is a sandboxed frame, which the browser caches apart each time, so fonts loaded there by URL were downloaded again for every article. Instead, the page fetches each font once in the background after the list loads, cached as usual, and hands it to every frame inline as a `data:` URL; the page's CSP allows `data:` fonts for this.

- **Each article opens with the upshot.** Two to four bullets, written once by the build from the article itself. Every figure in a bullet (CVE IDs, versions, dates, counts) must appear word for word in the article, or that bullet is dropped. The weekly essentials add their hand-picked "What to do" as the last line.
- **Page furniture is removed by what it is, never by who published it.** Bylines, dates, tables of contents, same-page links and "N min read" lines come out before the article is stored. If that would remove more than 35% of the text, the article is kept whole instead, because a stray byline beats a lost paragraph.
- **Article text is stored, but not in this repository.** It sits in a private KV namespace and expires after 100 days, shortly after a story leaves the site. It's a snapshot from when the story was first read, so later corrections by the publisher won't appear.
- **It says why when it can't.** Every response carries a reason: `ok`, `challenge` (the publisher blocks it), `shell`, `short`, `not_html` or `pending` (no article yet). The page already shows the story's summary from `data.json`, so a block never leaves it empty. Blocked stories are tried again on every build, and if a blocked publisher's feed carries whole articles, the build takes the article from the feed instead.
- **It isn't a proxy.** The Worker never fetches anything, and only returns articles the build stored.
- **The page can't run anything from the source site.** Extracted HTML is stripped of scripts, frames, styles and event handlers during the build, then rendered in a sandboxed frame with no access to the page. The only script allowed in there is the site's own swipe and keyboard relay, admitted by a per-render nonce.
- **A strict Content-Security-Policy backs all of this up.** Scripts load only from the site itself, plus two inline scripts allowed by exact hash; no plugins, forms or base-URL changes; network requests go only to the site. A test keeps the hashes in step with the code.
- **No login, no tracking.** Read and New markers live in your browser's local storage and never leave it.

## The Worker

[`wrangler.jsonc`](../wrangler.jsonc) holds the Worker's config: static assets from `site/` with `404.html` for unknown paths; code runs only for `/api/read` and for pages, which get a per-request CSP nonce so Cloudflare's Bot Fight Mode script can run; the `ARTICLES` KV binding; the custom domain; preview URLs for PRs; and Workers Logs, which keep a few days of the Worker's requests and errors.

Cloudflare Workers Builds deploys every push to `main` with `npx wrangler deploy`, including the bot's data commits, and builds a Preview for every other branch with its URL posted on the PR.

## It looks after itself

- A feed that has failed for two weeks, gone quiet or moved lands in a single "Feed health" issue that closes itself once it's fixed. For failing and quiet feeds it suggests any feeds the publisher's homepage advertises.
- A run where every LLM call fails exits with an error, so GitHub emails you.
- If Cloudflare KV is down, the stories are still published (the reader shows a fallback until a later build stores their text) and the run is marked failed after committing, so you hear about it without losing the build.
- When the data is more than 5 hours old (a build due every 4 hours is running at least 45 minutes late), a bar at the foot of the list says when it last updated, with a "Check again" button that fetches the data at once. Failed runs already email the repo's owner, so the bar is for readers and doesn't link to the build.
