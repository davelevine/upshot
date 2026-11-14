# Syncing what you've read

Sync keeps what you've read the same on every device, with no account, email or password. You make a short code on one device and enter it on another. This page covers pairing, how the server keeps devices in agreement, abuse limits, and the designs I tried first.

## Pairing devices

**Sync your reading** in the menu has two buttons:

- **Generate a sync code** turns sync on (or, on a device already syncing, makes another code). A code is eight characters, good once for ten minutes.
- **Already have a sync code?** on another device adds it. The field puts the dash in as you type.

Once the device syncs, the menu item and its sheet become **Sync settings**: the header's button does the syncing, and the sheet is where devices and codes are kept. It's the same move a browser makes when its "Sign in" becomes its account.

### QR codes

On a computer, the code comes with a QR code, the way WhatsApp Web and Signal Desktop pair. It's a link to `/#sync=<code>`, which a phone's camera opens and joins with.

- **How it's drawn.** The sync Worker draws it with [lean-qr](https://github.com/davidje13/lean-qr), a few KB. It's black on white with a quiet zone in either theme, since some cameras won't read an inverted code.
- **The code doesn't linger.** The page takes the code out of the address bar at once.
- **In-app browsers.** A camera's scan can open in an app's built-in browser (the Google app's, say), which keeps its own storage. There, the code is shown but not used, so you can enter it in your real browser.
- **Mistakes are recoverable.** A device that generated its own code by mistake can still enter another's, and moves across.

Signal and WhatsApp link devices the same way. When the new device joins, the one showing the code says so, and both sheets close.

## Where it runs

Sync runs in a second Worker, `upshot-sync` ([`sync/`](../../sync/)), which the site's Worker reaches over a service binding for `/api/auth/*` and `/api/sync`. It's separate because Cloudflare makes no preview URLs for a Worker that defines a Durable Object, and keeping it apart keeps previews for the rest of the site.

## How it works

- **A reader is a random id, and each of their devices holds a session for it.** The session is a cookie the page can't read: `upshot_session` holds the reader's id and a random token, `HttpOnly; Secure; SameSite=Lax`, for 400 days and renewed with use. Only the token's hash is stored. A cookie set by the server survives Safari clearing a site's script storage after a week away, so a device comes back still syncing and gets its read list back.
- **Each reader has a Durable Object of their own**, with SQLite tables for their devices and their marks. A Durable Object handles one call at a time, so two devices syncing at once can't overwrite each other, as they could with KV, whose writes take up to a minute to reach other locations. Codes live in one more Durable Object, consistent everywhere, so a code works the moment it's shown.
- **Codes are hard to guess and short-lived.** Crockford's base32 (no I, L, O or U; a typed O or I reads as 0 or 1), 2^40 codes, single use, ten minutes, and rate limited. A code for a sync whose last device has since left doesn't work.
- **Syncing and listing devices are one Durable Object call each.** The object checks the session in the same call that does the work, not in a separate one.

## Keeping devices in agreement

- **Sync is incremental both ways, and the server's merge is the truth.** A mark is `[read, changed at, opened]`. The page sends the marks it hasn't sent yet (in batches of 300), with a cursor. The Durable Object keeps each story's newest change and numbers every change it accepts (a counter of its own, so pruning never reuses a number). It returns the changes since the cursor, plus its version of any it turned down.
- **Clocks can't win an argument.** The page takes the server's answer over its own unless that story changed again locally since, so a device whose clock is off still ends up agreeing. A clock running ahead is also held to the server's time.
- **Marks for stories a tab hasn't loaded yet are kept,** so a sync that lands before a new build doesn't drop them.
- **When it syncs.** The page syncs on load, a few seconds after a change, when the tab is hidden or shown again, when another device changes something (below), and when the connection comes back.
- **A device that joins takes the sync's reading.** Entering a code replaces the device's read list with the sync's, the way a new device in a feed reader starts from the account. Anything it read beforehand stays unsent. That's deliberate: an unread story is only the absence of a mark, so a read sent on joining would always win, and a laptop's unread stories would go read the moment a phone joined. The first device's reading, and a browser's whose storage was cleared, are uploaded as before.
- **Every device counts the same older stories as read.** A browser's first visit treats stories from before the last day as read (`since` in site/app.js). Synced devices share the earliest such cutoff, so a phone that joins a laptop's sync shows the same unread stories, not just the same marks. A joining device takes the sync's cutoff rather than offering its own, so one that first visited long ago doesn't bring back stories the others count as read.
- **Tabs stay in step.** A tab takes up another tab's changes to what's stored (the `storage` event). That event can arrive late (a tab frozen in the background hears nothing until it wakes), so a tab also rereads what's stored before it changes the marks. That way it never writes an older copy back over another tab's marks, and a sync from a tab that hadn't yet heard sync was on can't take it for a browser whose storage was cleared and start over.

## Changes are pushed, never polled

While a device syncs and its tab is in view, the page holds a WebSocket to its sync's Durable Object, using Cloudflare's hibernation API. While it's quiet the object sleeps and isn't billed. Opening it is one request, and messages from the object are free (the page sends none).

When another device marks a story, joins or is removed, the object tells the others. Depending on what happened, they:

- pull the change,
- redraw an open device list, or
- stop syncing at once, sheet open or not (a device that's stopped syncing is told so, then its sockets close).

Hiding the tab closes the socket, so a sheet left open in a background tab costs nothing.

Every connection attempt syncs first. That catches up, and also tells a device that's been removed meanwhile, so it never tries a connection that can't open. Showing the tab reconnects that way, and a dropped socket retries the same way, waiting longer each time, up to a minute.

## Visitors who never turn sync on cost nothing

Beside the session cookie, the server sets `upshot_sync=1`, which holds no secret and which the page can read. Without it, the page never asks `/api/sync`. The cookie is renewed on every sync, so a device in use never expires.

## The sync button

Once a device syncs, a sync button sits in the header beside the menu, the way Obsidian shows sync in its status bar. It shows that sync is working, and it syncs on a tap.

- **A tap syncs now,** as a feed reader's refresh does. When Upshot can't be reached, it retries at once rather than waiting out the reconnect's backoff.
- **The icon is two circling arrows:** still when synced, turning while it syncs, struck through in red when Upshot can't be reached. Hovering it, or a screen reader, gives the words ("Synced 2m ago. Sync now").
- **Every sync shows.** Tapped or not, every sync turns the arrows at least once round and stops on a whole turn, so even a quick one is visible.
- **Sync settings** in the menu is where devices, codes and turning sync off live. When Upshot can't be reached it says so ("Couldn't reach Upshot. Last synced 5m ago.") with **Try again**.

I tried a cloud first, but its wide, short shape looked small beside the reader's round unread button. The icon also stays away from "Updated 1h ago" and the late bar's single-arrow **Check again**, which are about new stories, not sync.

## Managing devices

- **Any device can be removed from any other.** The sheet lists devices by browser and system ("Safari on iPhone") and when each last synced. Browsers that send Chrome's user agent word for word, such as Brave, are named from their client hints (`Sec-CH-UA`), and an app's built-in browser is named as such ("Google app on Android"), so you can tell which of your browsers is syncing.
- **This device is marked, but has no Remove of its own,** the way Signal and WhatsApp list linked devices. Leaving is **Turn off sync on this device**. Whatever the reason a device stops syncing, it says the same thing: "Sync is off on this device. It keeps what it has read."
- **A sync needs two devices.** When a removal leaves one device (or none), the sync ends: its data is deleted, and the device left keeps its own read list, which a new sync code would upload again. Its page hears at once and the sheet resets. A scanned code always joins: a device already syncing moves across.
- **Nothing is kept that nothing can reach.** With no account to sign back in to, a reader whose last device is removed is deleted, and so is one no device has used for 400 days, when every cookie has expired. A single device unused that long drops out of the list for the same reason.

There's no recovery: if every device stops syncing, the sync is gone. Each device keeps its own read list, and sync can be turned on again.

## Testing

The Durable Object's rules are unit-tested against a real SQLite with a clock the tests move (tests/reader.test.js). The browser tests check every action from every other device, sheet open and closed. [Testing](../development/testing.md) covers running them.

## Abuse is bounded

On the Free plan, a limit reached makes further calls fail until 00:00 UTC rather than adding to a bill. So the aim isn't to stop all abuse; it's to keep one script from using up the day's quota cheaply, and from piling up storage that doesn't clear itself.

- **Rate limited per address:** turning sync on and entering codes (30 a minute), and syncs and live connections (120 a minute, room for a household behind one address). Not the device list, nor a loopback address, which only local dev reports.
- **Requests are checked.** State-changing requests must come from the site's own origin; bodies are size-capped and checked. A sync takes at most 300 marks, as the page sends them, each for an address of at most 512 characters (the site's longest is under 200).
- **A socket that sends anything is closed.** Pages send nothing, and each message in is billed.
- **Storage is capped.** A reader keeps at most 2,000 marks, and marks untouched for 120 days (stories leave after 90) are dropped, by the next sync or, for a reader nobody syncs any more, by its alarm.
- **Each sync reads only the rows it needs:** indexes on the marks it looks up by change number, age and last touch, and a stored count, rather than a scan of every mark, since Durable Objects bill each row read.

It isn't airtight. A determined script with a session can use up the day's 100,000 rows written, and sync stops until midnight UTC. Bounding that would take a write budget per reader, which isn't worth it for a site this size.

## Designs I set aside

I tried three other designs before this one:

- **A random key kept in KV, shared by link.** KV is eventually consistent, so two devices syncing through different Cloudflare locations within about a minute could overwrite each other's changes. The key also lived in local storage, which Safari clears.
- **Cloudflare Access.** Real identity with almost no code, but only for allowlisted emails.
- **Passkeys.** Creating and using one differed by platform and password manager: a passkey in a Mac's own store wasn't visible to a phone using Bitwarden. Adding a device needed a code anyway, so the code became the whole design.
