# The site

The site is what a reader sees: the topics, the story list and the reader pane. [`site/index.html`](../../site/index.html) and [`site/app.js`](../../site/app.js) are the whole front end, with no framework and no build step.

## Layout

The layout follows desktop feed readers such as Feedbin:

- **Phones (up to 640px)** use pages. Upshot opens on the topics, a topic opens its list, and a story covers the list. Pages slide and follow a swipe; Back, the chevron and a swipe right step back.
- **641–1023px** docks the reader on the right, with the topics and the list as two pages of one left pane.
- **1024px and up** puts the sidebar, list and reader side by side. Dragging an edge resizes a column, and a double-click resets it.

From 641px up, the list stays live while an article is open, so `j`/`k` and clicks move through it. Full screen (`Shift F`, or the reader's display options) hides the topics and the list until it's turned off, `Esc` is pressed or the story closes.

## Lists and labels

The list showing is in the address (`/?topic=security`), so it can be bookmarked or reloaded into; All and a phone's topics page have none. Lists run newest first; stories of the same age keep the build's order, most relevant first. The essentials are an entry in the topics, so no story is listed twice.

A row carries at most one label, the same in every list:

- **Exploited**, with its remedy: "No patch yet" in red (the only filled mark on a row), "Patch available" in the accent color, or "Mitigation only" with no color.
- **Compromised** in yellow, for a supply-chain attack.
- **Essential**, left off rows in the Essentials list itself.

The last seven days' exploited flaws get their own entry under the essentials, showing "N unpatched" while any has no fix. [The pipeline](pipeline.md) covers how flags are set.

## Unread

Unread titles are bold, and the sidebar counts unread stories. A first visit starts with the last day's stories unread (or the newest five after a quiet stretch). The week's essentials stay unread until opened.

A toolbar after Feedbin's holds **Read**, which marks the list showing as read after you confirm (`Shift A` too), beside **Shortcuts** on a desktop or **Top** on a phone. The `…` on the selected story marks everything above or below it.

**Hide read stories**, a switch at the top of the menu, lists only unread stories, and the choice is kept on this device. A story read while a list shows stays in it until the list is drawn again (another list, or the switch turned off), so rows don't disappear while you read. Where a list ends, a line says read stories are hidden, with a link that shows them. Read later ignores the setting: stories are saved from the reader, so a saved story is always read.

## Read later

The bookmark in the reader's bar (`s` too) saves a story to **Read later**, an entry under the essentials that's always listed, since it's the reader's own list rather than one the news fills. It counts saved stories, read or not: the list empties as stories are removed, not as they're read. A saved row shows a small bookmark beside its age.

A saved story stays saved when it's read or marked read with the rest of a list, and leaves when the bookmark is turned off or the story leaves the site after 90 days. The list holds still while a story is open: a story unsaved, or one saved from search, leaves or joins it when the reader closes. Saves live in local storage like read state, and sync carries them too. Without sync, a line under the list says saves stay on this device, with a link that opens sync.

## The wordmark pass

When Upshot opens, or returns after 15 minutes away, the wordmark's spot runs once through the date, when the news last updated and when the next build is due, then settles back, after Kagi News. It takes under five seconds, and a tap ends it.

## The reader

Each build stores new stories' text in Cloudflare KV. A story whose feed carries the whole article (at least 300 words) takes it from there, so the site doesn't fetch the page. Otherwise, or when the entry ends like a cut-off excerpt (an ellipsis, "Read more"), the build reads the page with Mozilla's [Readability](https://github.com/mozilla/readability), falling back to the entry if the page is blocked. Opening an article calls `/api/read`, which the Worker answers from KV. The page also fetches the top six unread stories in the list ahead, once it's idle (not when the browser asks to save data), so those open at once; a stored article is kept by the browser for a day. Parsing happens in the build because it costs more CPU than the Worker gets per request on the free plan.

- **`Space` reads through the list.** It scrolls the article a screen at a time and, at the end, opens the next unread story in the list. Keys pressed inside the article reach the page through the frame's relay script.
- **Display options**, Feedbin's format icon at the end of the reader's bar, there on a desktop even with no story open: the theme (light, dark, or the system's; it's set only here), the text size, and from 641px up, full screen and fluid width. Fluid width lets the article fill the pane, its margins growing with it, never narrower than the fixed column; where the pane is no wider than that column, the menu says it needs a wider reader pane. Each is kept on this device.
- **It opens with the upshot.** Two to four bullets written by the build from the article. A bullet with a figure (a CVE, version, date or count) that isn't in the article word for word is dropped.
- **It isn't a proxy.** The Worker never fetches anything; it returns only what the build stored. A story without stored text shows its summary and a link to the original.
- **Nothing from the source runs.** Extracted HTML is stripped of scripts, frames, styles and event handlers, then shown in a sandboxed frame. The only script inside is the site's own relay, admitted by a per-render nonce.
- **Reader links name their story.** `/read/<slug>` serves the home page, so the Worker rewrites its title, description, canonical link and link-preview tags with the story's headline and summary. It finds the story by the same slug rules as `app.js`, and a test keeps the two in step.
- **A strict Content-Security-Policy** in [`site/_headers`](../../site/_headers) backs this up. A test keeps its script hashes in step with the code.
- **No login, no tracking.** What you've read stays in your browser's local storage unless you turn on [sync](sync.md).

Stored text expires after 100 days, shortly after a story leaves the site.

## Typography

Articles are set in Mercury, the publisher's words; everything else is in Söhne, Upshot's own. Both are licensed, so they live in a private R2 bucket, `upshot-fonts`, and the Worker serves them from `/fonts/licensed/`. Once the page is idle, it fetches the reader's fonts once and hands them to the sandboxed reader frame as `data:` URLs, so articles don't download fonts again. Mercury Text comes in two grades, one per theme, and only the theme's grade is fetched until the theme changes. Without the bucket, as in a fork, the site uses system fonts; [Configuration](../setup/configuration.md) covers adding them.

The article column is 35.5em wide, about 70 characters a line at every text size, and stays that wide in full screen unless fluid width is on.
