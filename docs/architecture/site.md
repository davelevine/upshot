# The site

The site is what a reader sees: the topics, the story list and the reader pane. [`site/index.html`](../../site/index.html) and [`site/app.js`](../../site/app.js) are the whole front end, with no framework and no build step.

## Layout

The layout follows desktop feed readers such as Feedbin:

- **Phones (up to 640px)** use pages. Upshot opens on the topics, a topic opens its list, and a story covers the list. Pages slide and follow a swipe; Back, the chevron and a swipe right step back.
- **641–1023px** docks the reader on the right, with the topics and the list as two pages of one left pane.
- **1024px and up** puts the sidebar, list and reader side by side. Dragging an edge resizes a column, and a double-click resets it.

From 641px up, the list stays live while an article is open, so `j`/`k` and clicks move through it.

## Lists and labels

Lists run newest first; stories of the same age keep the build's order, most relevant first. The essentials are an entry in the topics, so no story is listed twice.

A row carries at most one label, the same in every list:

- **Exploited**, with its remedy: "No patch yet" in red (the only filled mark on a row), "Patch available" in the accent color, or "Mitigation only" with no color.
- **Compromised** in yellow, for a supply-chain attack.
- **Essential**, left off rows in the Essentials list itself.

The last seven days' exploited flaws get their own entry under the essentials, showing "N unpatched" while any has no fix. [The pipeline](pipeline.md) covers how flags are set.

## Unread

Unread titles are bold, and the sidebar counts unread stories. A first visit starts with the last day's stories unread (or the newest five after a quiet stretch). The week's essentials stay unread until opened.

A toolbar after Feedbin's holds **Read**, which marks the list showing as read after you confirm (`Shift A` too), beside **Shortcuts** on a desktop or **Top** on a phone. The `…` on the selected story marks everything above or below it.

## Read later

The bookmark in the reader's bar (`s` too) saves a story to **Read later**, an entry under the essentials that's always listed, since it's the reader's own list rather than one the news fills. It counts saved stories, read or not: the list empties as stories are removed, not as they're read. A saved row shows a small bookmark beside its age.

A saved story stays saved when it's read or marked read with the rest of a list, and leaves when the bookmark is turned off or the story leaves the site after 90 days. A story unsaved while open stays in the list until the reader closes. Saves live in local storage like read state, and sync carries them too.

## The wordmark pass

When Upshot opens, or returns after 15 minutes away, the wordmark's spot runs once through the date, when the news last updated and when the next build is due, then settles back, after Kagi News. It takes under five seconds, and a tap ends it.

## The reader

Each build extracts new stories with Mozilla's [Readability](https://github.com/mozilla/readability) and stores the text in Cloudflare KV. Opening an article calls `/api/read`, which the Worker answers from KV. The page also fetches the top six unread stories in the list ahead, once it's idle (not when the browser asks to save data), so those open at once; a stored article is kept by the browser for a day. Parsing happens in the build because it costs more CPU than the Worker gets per request on the free plan.

- **It opens with the upshot.** Two to four bullets written by the build from the article. A bullet with a figure (a CVE, version, date or count) that isn't in the article word for word is dropped.
- **It isn't a proxy.** The Worker never fetches anything; it returns only what the build stored. A story without stored text shows its summary and a link to the original.
- **Nothing from the source runs.** Extracted HTML is stripped of scripts, frames, styles and event handlers, then shown in a sandboxed frame. The only script inside is the site's own relay, admitted by a per-render nonce.
- **A strict Content-Security-Policy** in [`site/_headers`](../../site/_headers) backs this up. A test keeps its script hashes in step with the code.
- **No login, no tracking.** What you've read stays in your browser's local storage unless you turn on [sync](sync.md).

Stored text expires after 100 days, shortly after a story leaves the site.

## Typography

Articles are set in Mercury, the publisher's words; everything else is in Söhne, Upshot's own. Both are licensed, so they live in a private R2 bucket, `upshot-fonts`, and the Worker serves them from `/fonts/licensed/`. The page fetches each font once and hands it to the sandboxed reader frame as a `data:` URL, so articles don't download fonts again. Without the bucket, as in a fork, the site uses system fonts; [Configuration](../setup/configuration.md) covers adding them.
