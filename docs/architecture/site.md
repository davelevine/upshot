# The site

The site is what a reader sees: the topics, the story list and the reader pane. [`site/index.html`](../../site/index.html) and [`site/app.js`](../../site/app.js) are the whole front end, with no framework and no build step.

## Layout

The layout follows desktop feed readers such as Feedbin:

- **Phones (up to 640px)** use pages. Upshot opens on the topics, a topic opens its list, and a story covers the list. Pages slide and follow a swipe; Back, the chevron and a swipe right step back.
- **641–1023px** docks the reader on the right, with the topics and the list as two pages of one left pane.
- **1024px and up** puts the sidebar, list and reader side by side. Dragging an edge resizes a column, and a double-click resets it.

From 641px up, the list stays live while an article is open, so `j`/`k` and clicks move through it. Full screen (`Shift F`, or the reader's display options) hides the topics and the list until it's turned off, `Esc` is pressed or the story closes.

## Lists and labels

The list showing is in the address (`/?topic=security`), so it can be bookmarked or reloaded into; All and a phone's topics page have none. Lists run newest first; stories of the same age keep the build's order, most relevant first. The tab's title starts with the unread count across all stories, as in `(3) Security · Upshot`, and an installed app's icon shows it as a badge where the system draws one (Chrome and Edge on a computer). Upshot doesn't ask for notification permission, which iOS requires for a badge, and Android and Firefox don't show one. The essentials are an entry in the topics, so no story is listed twice.

A row carries at most one label, the same in every list:

- **Exploited**, with its remedy: "No patch yet" in red (the only filled mark on a row), "Patch available" in the accent color, or "Mitigation only" with no color.
- **Compromised** in yellow, for a supply-chain attack.
- **Essential**, left off rows in the Essentials list itself.

The last seven days' exploited flaws get their own entry under the essentials, showing "N unpatched" while any has no fix. [The pipeline](pipeline.md) covers how flags are set.

## Search

On a desktop, the search bar, `/` and `⌘K` (`Ctrl K`) open a search panel over the page. Before anything is typed it lists the stories read last, or the newest five; typing searches every story's title, summary, publisher and site, title matches first.

On a phone, the header's search icon opens a field under the header, and typing narrows the list itself, newest first, read stories included. In any list but All, a chip with the list's name keeps the search inside that list; tapping the chip, or Backspace in the empty field, searches every story. Back, the search icon or `Esc` closes it, and the list returns as it was. While searching, **Read** marks the matching stories. A keyboard's `/` opens the desktop's panel instead, full screen.

## Unread

Unread titles are bold, and the sidebar counts unread stories. A first visit starts with the last day's stories unread (or the newest five after a quiet stretch). The week's essentials stay unread until opened.

A toolbar after Feedbin's holds **Read**, which marks the list showing as read after you confirm (`Shift A` too), beside **Shortcuts** on a desktop or **Top** on a phone. The `…` on the selected story marks everything above or below it.

**Hide read stories**, a switch at the top of the menu, lists only unread stories. The choice is kept on this device and, with sync on, on the others too. A story read while a list shows stays in it until the list is drawn again (another list, or the switch turned off), so rows don't disappear while you read. Where a list ends, a line says read stories are hidden, with a link that shows them. Read later ignores the setting: stories are saved from the reader, so a saved story is always read.

**RSS feeds**, the menu's next row, opens under itself to list the three feeds: All stories, Essentials and Exploited. The page also advertises each with `<link rel="alternate">`, so a feed reader given the site's address offers all three.

## Read later

The bookmark in the reader's bar (`s` too) saves a story to **Read later**, an entry under the essentials that's always listed, since it's the reader's own list rather than one the news fills. It counts saved stories, read or not: the list empties as stories are removed, not as they're read. A saved row shows a small bookmark beside its age.

A saved story stays saved when it's read or marked read with the rest of a list, and leaves when the bookmark is turned off or the story leaves the site after 90 days. The list holds still while a story is open: a story unsaved, or one saved from search, leaves or joins it when the reader closes. Saves live in local storage like read state, and sync carries them too. Without sync, a line under the list says saves stay on this device, with a link that opens sync.

## The wordmark pass

When Upshot opens, or returns after 15 minutes away, the wordmark's spot runs once through the date, when the news last updated and, unless the build is late, when the next one is due, then settles back, after Kagi News. It takes under five seconds, and a tap ends it.

## The reader

Each build stores new stories' text in Cloudflare KV. A story whose feed carries the whole article (at least 300 words) takes it from there, so the site doesn't fetch the page. Otherwise, or when the entry ends like a cut-off excerpt (an ellipsis, "Read more"), the build reads the page with Mozilla's [Readability](https://github.com/mozilla/readability), falling back to the entry if the page is blocked. It fetches only public addresses, checking each redirect, and reads at most 3 MB of a page within 15 seconds. Opening an article calls `/api/read`, which the Worker answers from KV. The page also fetches the top six unread stories in the list ahead, once it's idle (not when the browser asks to save data), so those open at once; a stored article is kept by the browser for a day. Parsing happens in the build because it costs more CPU than the Worker gets per request on the free plan.

- **`Space` reads through the list.** It scrolls the article a screen at a time and, at the end, opens the next unread story in the list. Keys pressed inside the article reach the page through the frame's relay script.
- **Display options**, Feedbin's format icon at the end of the reader's bar, there on a desktop even with no story open: the theme (light, dark, or the system's, and syncs; on a phone the header menu has it too, since the reader's bar shows only with a story open), the [typeface](#typography), the text size, and from 641px up, full screen and fluid width. Fluid width lets the article fill the pane, its margins growing with it, never narrower than the fixed column; where the pane is no wider than that column, the menu says it needs a wider reader pane. Each is kept on this device; the theme and typeface also go to the reader's other devices with [sync](sync.md). A browser that blocks the site's storage (cookies blocked for it) keeps them for the visit only.
- **Listen**, the headphones in the reader's bar (`l` too), plays the story's audio: the headline, the upshot, then the article, read by Kokoro after each build ([The pipeline](pipeline.md#audio)) and served from the audio bucket ([Hosting](hosting.md#audio)). A bar under the article pauses it, skips a block either way, sets the speed (1×, 1.25× or 1.5×, picked from a list and kept on this device) and says how long is left. The audio comes with the second each block starts, so the block playing is highlighted and kept in view, and a click on another plays from there; if the page's blocks aren't the ones the audio was timed by, nothing is highlighted and a skip is 15 seconds. A long story's audio is its headline and upshot, and a card's its summary, which the bar says. It's a plain audio element, so it plays on with the phone locked, with controls on the lock screen through the Media Session. It stops when the story closes or another opens, but not when a story's article replaces its card. The page reads the bucket's index on load and again with each new build, so only a story with audio has the button, and nothing is asked for that isn't there.
- **It opens with the upshot.** Two to four bullets written by the build from the article. A bullet with a figure (a CVE, version, date or count) that isn't in the article word for word is dropped, and with fewer than two left the upshot is left out.
- **It isn't a proxy.** The Worker never fetches anything; it returns only what the build stored. A story without stored text shows its summary and a link to the original.
- **Nothing from the source runs.** Extracted HTML is stripped of scripts, frames, styles, event handlers, hidden elements and class names (which would otherwise match the frame's own), then shown in a sandboxed frame. The only script inside is the site's own relay, admitted by a per-render nonce.
- **Reader links name their story.** `/read/<slug>` serves the home page, so the Worker rewrites its title, description, canonical link and link-preview tags with the story's headline and summary. It finds the story by the same slug rules as `app.js`, and a test keeps the two in step. A slug is the headline's first words, with a short hash of the URL when two headlines share them. Either form finds its story, so a shared link survives such a clash starting or ending.
- **A strict Content-Security-Policy** in [`site/_headers`](../../site/_headers) backs this up. A test keeps its script hashes in step with the code.
- **No login, no tracking.** What you've read stays in your browser's local storage unless you turn on [sync](sync.md).

Stored text expires after 100 days, shortly after a story leaves the site.

## Typography

Articles are set in Domaine by default: Domaine Text for the article and Domaine Display for its headline. Everything else is in Söhne, Upshot's own, including the upshot and the date line whatever the article's typeface.

**Typeface** in Display options offers six, after Feedbin's: System, Atkinson Hyperlegible Next and Söhne in sans; System Serif, Literata and Domaine in serif. Each name is set in its own face, and those fonts download only when the menu first shows them. Every typeface but Söhne is brought to Domaine's x-height (0.505em), so a text size reads the same in each: Domaine with `size-adjust`, the rest with `font-size-adjust`, which also reaches the system's fonts. Söhne keeps the page's tuning, since at that x-height it reads small. Picking a typeface changes the open article in place, holding the paragraph in view.

Domaine and Söhne are licensed, and Literata and Atkinson are open (SIL Open Font License). All four live in a private R2 bucket, `upshot-fonts`, and the Worker serves them from `/fonts/licensed/`, so no font request leaves the site. When the first story opens, the page fetches the chosen typeface's fonts once and hands them to the sandboxed reader frame as `data:` URLs, so articles don't download fonts again; a visit that opens nothing never downloads them, and only the typeface in use is fetched. Literata and Atkinson come in two subsets: latin, handed over with the rest, and latin-ext, left for the browser to fetch only for an article with one of its letters. That first story waits briefly for them, so it doesn't draw in a fallback font first. Without the bucket, as in a fork, the site uses system fonts; [Configuration](../setup/configuration.md) covers adding them.

The article column is 35.5em wide, about 70 characters a line at every text size, and stays that wide in full screen unless fluid width is on.
