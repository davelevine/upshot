# The site

[`site/index.html`](../../site/index.html) and [`site/app.js`](../../site/app.js) are the whole front end: no framework, no build step. This page covers how the layout adapts to each screen, how lists and labels behave, what counts as unread, and the short pass that runs through the wordmark when you open it.

## Layout

The layout follows desktop feed readers such as Feedbin, in three widths.

### Phones (up to 640px)

Pages, as in Feedbin's app. Upshot opens on the topics. Picking one opens its list, with a back chevron and its name in the header, and a story covers the list.

Each page slides over the one before and follows your finger when swiped. Back, the chevron and a swipe right step back through them; a swipe left goes forward again, into the list you just left or the story you just closed. Articles read once are kept for the visit, so reopening one is instant.

### 641–1023px

The reader is docked on the right, as it is from 1024px. The topics and the list are two pages of one left pane, scrolled sideways, as in Feedbin. Upshot opens on the list, and picking a topic slides to its list. The pane narrows (to 280px at 641px) so the article keeps at least 360px.

### 1024px and up

Sidebar, list and reader side by side. Dragging the sidebar's or the list's edge resizes it; the widths are kept in the browser, and a double-click resets them.

### From 641px up

There's no full-width header: the logo tops the left pane, and the menu sits at the end of the reader bar. The reader stays docked and the list scrolls on its own. The list also stays live while an article is open, so `j`/`k` and clicks move through it.

## Lists

The essentials are an entry in the topics, not a separate section, so no story is listed twice.

Lists run newest first, by the age each row shows. Stories of the same age keep the build's order, most relevant first.

## Labels

A row carries at most one label, the one that matters most, and it's the same in every list:

- **Exploited**, with its remedy:
  - **"No patch yet"** is red, with the word. It's the only filled mark on a row, and it stays that way while there's nothing to apply.
  - **"Patch available"** is in the accent colour.
  - **"Mitigation only"** has no colour.
  - Nothing at all when the story doesn't say.
- **Compromised**, for a supply-chain attack, is yellow: a warning rather than a danger.
- **Essential** otherwise, which the Essentials list leaves off its own rows.

The last seven days' exploited flaws are listed in their own entry under the essentials, which shows only when there are any. While any of them has no fix, that entry shows "N unpatched" in place of its unread count. The reader shows the same label, and "confirmed by CISA" when the catalog lists it. [Exploited flags](exploited-flags.md) covers how the labels are decided.

## Unread

Unread titles are bold, so nothing else marks new stories. The sidebar counts unread stories, as a feed reader does.

- **A first visit** starts with the last day's stories unread, or the newest five after a quiet stretch, and older ones show as read. After that, anything added since counts.
- **The week's essentials** count as unread until opened, however old.
- **An older story marked unread by hand** stays unread.

## The toolbar

A toolbar modelled on Feedbin's holds two buttons, each centred in half of it:

- **From 1024px**, at the sidebar's foot (the pane's below that): **Shortcuts** and **Read**.
- **On a phone**, a list's bottom bar: **Top** (back to the top, dimmed when you're already there) and **Read**.

**Read** marks the list that's showing as read once you confirm (`Shift A` does the same). The `…` on the selected story (the one open, or on a phone the one just closed) marks the stories above or below it.

Bulk marks go in at the oldest end of the read list, so the search panel's "Recently read" still starts with what you actually opened.

## The pass through the wordmark

I borrowed this from Kagi News. Each time Upshot opens, or comes back after 15 minutes away, the wordmark shows for a moment. Then its spot runs once through:

1. the date
2. when the news last updated
3. when the next build is due, from the build's schedule (`17 * * * *` UTC), and left out when a build is late

Then it settles back on the wordmark. It doesn't run on a refresh, or on a new tab within 15 minutes of the last pass.

After that, the sidebar's foot keeps saying it: "Updated 1h ago" just above the toolbar (on a phone, a thin strip over a list's bottom bar). When a build is late, that gives way to the late bar, in the same place.

The pass takes under five seconds, so it needs no pause control under WCAG 2.2.2, and a tap ends it.

## Security headers

[`site/_headers`](../../site/_headers) sets the Content-Security-Policy. [The reader](reader.md) covers what it allows and why.
