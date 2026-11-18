# Sync

Sync keeps what you've read, what you've saved for later and how Upshot looks the same on every device, with no account, email or password. It runs in a second Worker, `upshot-sync` ([`sync/`](../../sync/)), which the Site Worker reaches over a service binding.

## Pairing

**Sync your reading** in the menu has two buttons:

- **Generate a sync code** turns sync on and shows an eight-character code, good once for ten minutes.
- **Already have a sync code?** adds this device to a sync.

On a computer, the code also comes as a QR code that a phone's camera opens and joins with. If the scan opens in an app's built-in browser, which keeps its own storage, the code is shown for you to enter in your real browser instead.

Once a device syncs, the menu item becomes **Sync settings**, with a line under it saying when it last synced. Sync runs by itself, so it has no button of its own; while it's failing, a dot on the menu's button says so.

## How it works

- **Sessions.** Each device holds a session cookie the page can't read (`HttpOnly`, 400 days, renewed with use). Only a hash of its token is stored.
- **One Durable Object per reader** holds their devices and read state in SQLite. It handles one call at a time, so two devices syncing at once can't overwrite each other. A second Durable Object holds the codes.
- **The server's merge wins.** The page sends only what changed, and takes the server's answer over its own unless that story changed again locally. A device with a wrong clock still ends up agreeing.
- **A joining device takes the sync's read state.** Entering a code replaces the device's read state rather than merging it, so a new phone can't mark a laptop's unread stories as read. It takes the sync's preferences too, so it looks like the other devices from the start.
- **Changes are pushed.** While a tab is visible, the page holds a WebSocket to the Durable Object, using Cloudflare's hibernation API, so a quiet connection isn't billed. Hiding the tab closes it.
- **Read later syncs on its own.** Saves go in the same request as read state but are merged apart from it, each story's newest save or removal winning, so saving a story on one device never changes whether another has read it. Joining by code keeps the device's saves and adds the sync's, since a save is never an absence.
- **Preferences follow the reader.** The theme, the article's typeface and Hide read stories sync, each one's newest change winning, and every open tab follows. Text size, fluid width and full screen stay with the device, since they suit a screen rather than a reader. The sync server stores them as one small record and accepts any short setting name and value, so a new preference on the page needs no change there.
- **No cost without sync.** A browser that never turns sync on never calls `/api/sync`.

## Managing devices

**Sync settings** lists devices by browser and system ("Safari on iPhone") and when each last synced. Any device can remove any other; this device leaves with **Turn off sync on this device**, and keeps what it has read.

A sync needs two devices. When a removal leaves one, the sync and its data are deleted. A reader no device has used for 400 days is deleted too. There's no recovery, but sync can always be turned on again.

## Limits

On the Free plan a limit makes calls fail until midnight UTC instead of adding to a bill, so the limits keep one script from using up the day cheaply:

- Turning sync on and entering codes: 30 a minute per address. Syncs and live connections: 120 a minute.
- Requests must come from the site's own origin, and a sync carries at most 300 changes.
- A reader keeps read state for at most 2,000 stories and saves for at most 500, and anything untouched for 120 days is dropped.
- A socket that sends anything is closed.

A determined script with a session can still use up the day's 100,000 row writes. A per-reader write budget would close that, and isn't worth it at this size.

## Why it's built this way

- **Durable Objects, not KV.** KV is eventually consistent, so two devices syncing through different locations could overwrite each other.
- **A session cookie, not a key in local storage.** Safari clears script storage after a week away; a server-set cookie survives it.
- **Codes, not accounts.** Cloudflare Access only works for allowlisted emails.
- **Codes, not passkeys.** A passkey in one password manager isn't visible to another, and adding a device would need a code anyway.
