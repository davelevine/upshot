# Lessons

## 2026-11-11 — Borrowed UI patterns need their counterweights

**Mistake:** Ported Feedbin's bottom toolbar for Mark all as read, but Upshot has none of Feedbin's other toolbar buttons (Edit, Add), so it became a single button stranded at the end of an otherwise empty bar. The screenshots were checked against the reference ("Read is on the right, like Feedbin") instead of judged on their own, and the result was called right.

**Rules:**
- When adopting a pattern from another app, list what made it work there (neighbouring controls, balance, density). If Upshot lacks those, adapt the pattern; don't copy its placement.
- Judge screenshots as a designer seeing them cold: does every element earn its space, and does any control look orphaned? Matching the reference is not the bar.
- When an option has a known weakness (here, "Upshot has no Edit"), resolve it in the design before building, rather than leaving it in the option's fine print.
- Before saying a UI looks good, name at least one weakness. If none comes to mind, look again.

## 2026-11-11 — Research conventions before offering options

**Mistake:** After the bottom toolbar was rejected, three new placements were offered from first principles (beside search, in the ⋯ menu, at the list's end), none of them grounded in what feed readers actually do. All three were rejected.

**Rules:**
- For any UI placement question, survey how several established apps in the category solve it first, and cite them. Offer options only from that evidence, and say which apps each one follows.
- One reference app (Feedbin) is not a convention. Look for where most apps agree, and why.

## 2026-11-11 — Ad-block cosmetic lists hide controls by name

**Mistake:** The phone toolbar's Top button was named `aria-label="Back to top"`. Fanboy's Annoyance list (used by Brave and uBlock) has a generic `##[aria-label="Back to top"]` rule, so the button vanished on the user's phone while passing in plain Chromium. The share menu had already hit the same class of bug (`.share-wrap`).

**Rules:**
- Before shipping a new control, check its id, class, aria-label and title against EasyList and Fanboy's Annoyance list (download them and grep the `##` generic rules). Avoid names like back-to-top, share, social, banner, sticky, newsletter, cookie.
- Add a smoke assertion that none of the known hiding selectors match, as in `test_back_to_top_survives_annoyance_lists`.

## 2026-11-12 — Measure against complete references, and ask what a screenshot shows

**Mistake:** Matched the sidebar toolbar to a Feedbin screenshot that was cropped at the bottom, then reported a half-pixel match. When the user said the buttons still looked low, assumed their screenshot was of production rather than the PR preview they were testing, and compared their capture against a local render made a different way.

**Rules:**
- Before measuring against a reference screenshot, check it runs to the window's edges (look for the edge or border row); if it's cropped, say so and ask for a full one.
- Only compare like with like: two of the user's captures with each other, or two of mine. Don't mix a user capture with a local render.
- When the user sends a screenshot of their own testing, don't guess its source; ask if it isn't stated.

## 2026-11-12 — Stage exact paths, never a directory, when local data is modified

**Mistake:** For the Tailscale preview, `site/data.json` was edited locally to simulate flagged stories. A later `git add site` swept that file into a feature commit, which was pushed. The safe fix (a commit restoring the file) left the fake data in the branch's history. Separately, test servers were twice started with `&` instead of as tracked background tasks, which the memory notes already forbid.

**Rules:**
- Stage files by exact path (`git add site/app.js site/index.html`), never a directory, whenever anything is modified for a preview or experiment.
- Run `git diff --cached --stat` before every commit and check that every file is meant to be there; `site/data.json`, `state.json` and `site/rss.xml` belong to the build, never to a feature commit.
- Keep preview-only data outside the repo (serve a patched copy, or route it in the browser) rather than editing tracked files.
- Start `wrangler dev` only with `run_in_background`, never `&`.

## 2026-11-12 — A new rule must not quietly override a preference the user already stated

**Mistake:** The user asked for the Exploited label to look the same in every section. Later, a general "no list repeats its own name" rule (which the user approved) was applied to the Exploited list too, dropping the word there, so the same story read differently in All and in Exploited. The user had to point out the inconsistency again.

**Rules:**
- Before applying a new general rule, check it against preferences the user stated earlier in the work. Where they conflict, name the conflict and ask; don't let the newer rule win silently.
- After a UI change, compare the same item across every view it appears in (All, each topic, each special list), not just the view being changed.

## 2026-11-12 — Evaluate every path a record can take, not just the new-arrival one

**Mistake:** The Exploited flag's remedy was evaluated only for stories as they arrive (scored, then summarised). Stories flagged later, by a CISA listing after publication, which was every flag on the first live build, never went through either check, so they showed no remedy even when their own upshot named the patch. The user caught it on the live site.

**Rules:**
- For any per-record state, list every way a record can reach it (on arrival, on a later build, by a backfill, via another record) and check that each path fills every field, before calling the evaluation done.
- After a feature ships, look at its first real output on the live site, not only at the dry runs.

## 2026-11-12 — A screenshot must show what it claims: check the selection is in view

**Mistake:** The README composites opened the Barracuda story in the reader while the list was scrolled to the top. The story was row 31, two days old, so the composite showed an open story with no matching row in the list. The capture script printed "story is row 31" and it was ignored; the user caught it after the PR merged. The earlier composites had the same gap.

**Rules:**
- In any screenshot with a selection (an open story, a highlighted row), check that the selected item is visible and highlighted in the shot, not just open in the reader.
- Read every number a capture script prints and ask what it implies for the image; "row 31" in a 900px window means off-screen.
- When choosing the story, weigh what it shows (its picture, its label) over how near the top it sits: the user chose Barracuda, scrolled to row 32, over a weaker story at row 2.

## 2026-11-12 — Check a PR is still open before pushing more work to it

**Mistake:** The user merged #148 while follow-up commits (the Barracuda composites they had just chosen, and a lessons fix) were still being made. Those were pushed to #148's branch after the merge, so they missed `main` and needed a second PR (#149).

**Rules:**
- Before every push to an existing PR branch, run `gh pr view <n> --json state` and push only if it's `OPEN`; if it merged, branch from `origin/main` and open a new PR.
- After the user says a PR merged, check with `git merge-base --is-ancestor` that every commit meant for it is on `main`.

## 2026-11-13 — Loading placeholders must not flash on a normal load

**Mistake:** Added skeleton rows to the sidebar so it wouldn't sit blank while `data.json` loaded. On a real refresh the stories arrive in about 60ms, so the placeholders (the new ones, and the list's existing ones) only flashed for a few frames. The user saw it on the first refresh of the preview. The probes that "showed" the loading state had held `data.json` back on purpose, so they never showed what an ordinary refresh looks like.

**Rules:**
- Before adding loading UI, time a normal refresh (`performance.getEntriesByName`) and count the frames the loading state is visible on an unthrottled load. If it's a flash, hold it back (`.skeleton`'s 400ms delayed fade-in) or don't add it.
- Screenshots of a forced slow or failed load prove the state looks right, not that it's welcome; check the fast path too.

## 2026-11-13 — A font check in headless Chromium doesn't show what the user's browser renders

**Mistake:** Swapped the reader font to Mercury Text and reported it working because headless Chromium loaded the faces and the screenshot looked right. In the user's browser the article still rendered in a fallback serif (with ligatures that Mercury's files don't contain). Only Chromium had been checked, and the screenshot was never compared with a sample of the font itself.

**Rules:**
- For a font change, say which engine was checked. If Safari/WebKit or Firefox can't run here, say so instead of reporting the change as working.
- Check the glyphs against the font file, not just `document.fonts`: look for a feature the font lacks (ligatures, oldstyle numerals) or a distinctive letterform, so a fallback can't pass as the real face.

## 2026-11-13 — Walk the whole journey across devices before calling a flow done

**Mistake:** Device sync first paired by a capability link. It was checked for security and tested in two browser contexts on one machine, where moving the link was free. On real hardware the user found Copy did nothing (no clipboard on a plain-HTTP preview), there was no easy way to get the link to another machine, and Join left the sheet open. Pairing was rebuilt around short codes, after TV sign-in (RFC 8628).

**Rules:**
- For any flow that spans devices or apps, write out each step a person takes on each device, including how data physically moves between them, before building. A step like "open this link on your other device" needs its own answer.
- Survey how established products solve the interaction (here: TV activation codes, Signal/WhatsApp QR, Brave Sync codes) before choosing a mechanism, not only how to make it secure.
- Test where the user will test: the plain-HTTP Tailscale preview disables the clipboard and share sheet, so anything depending on them needs a fallback or must not depend on them.
- A completed action closes its sheet and leaves visible evidence (the list updating), unless there's a reason to stay.

## 2026-11-13 — Check a store's consistency before building read-modify-write on it

**Mistake:** The sync prototype read a reader's state from KV, merged, and wrote it back. KV is eventually consistent across locations (up to a minute), so two devices syncing through different locations could overwrite each other, and the losing device never resent its changes. Tests ran against a local, fully consistent KV and passed. The user's sense that it "didn't feel robust" was what prompted a closer look.

**Rules:**
- Before any get → change → put, write down the store's consistency and concurrency guarantees, and what happens when two writers interleave. If it's eventually consistent or has no compare-and-set, use a store that serialises writes (a Durable Object, D1) instead.
- A local emulator is usually more consistent than production; a test passing locally says nothing about cross-location races. Name that gap in the test or PR rather than implying coverage.
- When a user says a design feels fragile without naming why, list every caveat accumulated so far; a growing list of patches is the signal to revisit the foundation.

## 2026-11-13 — Judge a sign-in prompt as a wary stranger, and give it one shape

**Mistake:** The first passkey sheet asked "Create a passkey or Sign in?" before saying what either was for, listed Face ID, Touch ID and Windows Hello by name, and said "No password or email" without saying what Upshot keeps. The user said they'd avoid it on any site. The rewrite then mixed three alignments in one box (left text, right-floated button, centred footer), which the user also rejected.

**Rules:**
- Before showing any sign-in, permission or data prompt, read it as someone who has never seen the site: what do I get, what do they keep, what am I agreeing to? Answer those before asking for a decision. Check copy against established guidance (FIDO Alliance, Google's passkey UX) rather than writing from first principles.
- Don't name biometrics or brands; say what it's like ("the way you unlock your device"), or let the system sheet explain it.
- First use gets the primary action; returning use is secondary. Never make "Sign in" primary for someone with no account.
- One alignment per sheet. For a choice of actions, stack full-width buttons with the main one first, and put small print under them.

## 2026-11-13 — Don't build on an ecosystem assumption the user's own setup breaks

**Mistake:** Passkey sync assumed one password manager would carry the passkey to every device. The user's Mac (Zen) saved it in the Mac's own store, their phone uses Bitwarden, and neither could reach the other: Sign in found nothing, and Add a passkey couldn't offer Bitwarden. Mixed managers are common, and the design had no path for them.

**Rules:**
- For any flow that depends on a platform feature crossing devices (passkey sync, iCloud, Google accounts), list the common mixes (Apple + Windows, Bitwarden/1Password + a built-in store, a device-bound key) and give each a path before shipping. Passwordless designs need an approve-from-a-signed-in-device route.
- Ask what the user actually uses (browser, OS, password manager) before testing a cross-device feature on their devices, and check the design against that first.
- When a rate limit covers an endpoint the UI polls, the UI will lock the person out. Rate-limit only what can be guessed or spammed, and test the limit with the UI's real request pattern.

## 2026-11-13 — Follow the repo's documentation conventions over generic ones

**Mistake:** Wrote `docs/adr/0001-…` for the sync decision because the global CLAUDE.md says to propose ADRs. This repo has never had ADRs; its decisions live in `docs/architecture.md`. The user said so.

**Rules:**
- Before adding a new kind of document, check what the repo already does (here: architecture.md, setup.md, developing.md, PR descriptions). A generic instruction to write ADRs, design docs or changelogs doesn't apply where the project has its own place for that.
- Record rejected options and their reasons in the existing doc that describes the feature.

## 2026-11-13 — One name for one idea, on every button

**Mistake:** Code-based sync described the same thing three ways: "Turn on sync", "Add a device" and "Use a code from another device". Each made sense alone, but together they hid that it's all one idea, a code made on one device and typed on another. The user asked for "Generate a sync code" and "Already have a sync code".

**Rules:**
- Name the core object once ("sync code") and use that exact noun on every button, heading, instruction and error that involves it.
- Label buttons by what the person does with that object, not by its side effects ("Generate a sync code", not "Turn on sync").
- Read the button labels on their own, in order: if they don't tell the whole story, rename them before adding explanation.

## 2026-11-13 — Leave the person where they can act next

**Mistake:** Removing this device, or deleting sync data, closed the sheet, so the person was dropped back on the page with no sign of what happened or what to do next. The user said the sheet shouldn't close. A "Done" button that navigated instead of closing had the opposite problem.

**Rules:**
- After an action that changes state but leaves more to do (stop syncing, delete), keep the sheet open on the view that comes next, with a short neutral line saying what happened. Close only when the task is finished (joining, Done).
- A button labelled Done closes; Back navigates. Check each button's label against what it does.
- When a status lives in a slot that another state can replace (the late bar replacing "Updated…"), show it in every variant of that slot.

## 2026-11-13 — Put a status where its subject is, not where there's room

**Mistake:** The sync indicator went beside "Updated 1h ago" because that slot already showed status. But that status is about new stories, and in the late bar the icon sat beside the refresh button: too small, and easy to read as part of the article updates. The user found it confusing. It moved to its own header button that opens the sync sheet.

**Rules:**
- Place an indicator beside the thing it reports on, or make it a control that opens that thing. Never next to a status or button about something else, however convenient the slot.
- An indicator should match the size of the controls around it.

## 2026-11-13 — Don't put "remove myself" in the same row style as "remove that"

**Mistake:** The device list gave this device the same **Remove** button as the others, listed first. Removing it made the whole list vanish, so the user believed both devices had gone, while the phone carried on alone. The server was right; the screen misled.

**Rules:**
- In any list of sessions, devices or members, mark the current one and keep its leave action separate and explicitly worded ("Stop syncing on this device"), as Signal, WhatsApp and Google do.
- After a destructive action, say what happened to everything else it touched ("your other devices keep syncing" / "it was the last one").
- When a user reports impossible-seeming behaviour, check the server's actual state and reproduce each reading of their steps before changing anything.

## 2026-11-13 — Audit the whole feature before handing it over, not the latest fix

**Mistake:** Sync went back and forth for many rounds, each fixing what the user had just found. Every fix was checked on its own, and nothing checked the feature as a whole, so problems the user would have hit next (two tabs wiping marks, devices drifting on clock skew, cookies never renewed, a per-visitor request, lost focus) waited for them to find. When the user called it whack-a-mole, one audit (an independent code review plus a walk through every state) found fifteen.

**Rules:**
- Before presenting a feature with state across devices, tabs or time, audit it end to end: list every state and every transition; ask what happens with two tabs, offline, clock skew, a stale or expired session, a request that fails partway, and the first visit versus the hundredth.
- Get an independent read of the code (a fresh agent given only the code and the feature, not my conclusions) for anything non-trivial; it found what I'd stopped seeing.
- Review the UI as a set: lay every screen out on one contact sheet and read the wording and layout across them, not one screenshot at a time.
- Count the cost per visitor of anything that runs on page load, and check what it costs people who never use the feature.
- Any view that shows server state (a device list, a code waiting to be used) can go stale while it's open. Decide for each how it learns of changes made elsewhere (recheck while open, or on focus), and test it with the view left open while another device acts. Found only after the user hit it, two rounds after the audit.

## 2026-11-13 — Push changes; don't poll for them

**Mistake:** To keep an open sheet current I added polling (every 5 s on the device list, 3 s on a code, 15 min while visible), each poll two Durable Object calls. The user rightly saw it could burn through the free tier if left open, and that pushing on change is the better design. Cloudflare's Durable Objects hold WebSockets with a hibernation API built for exactly this.

**Rules:**
- When a screen needs to reflect changes made elsewhere, reach for the platform's push mechanism first (Durable Object WebSockets with hibernation, here), and poll only as a fallback.
- Before adding anything that repeats on a timer, work out its cost per hour left running, in a background tab, against the free tier, and say it.
- Close long-lived connections when the tab is hidden; reconnect and catch up once when it's shown.

## 2026-11-14 — Before handling an edge case, ask whether it needs to exist

**Mistake:** Each round of sync feedback added a mechanism: a message per reason sync stopped (four), a way out per situation (three, plus confirmations and single-device variants), an expiry alarm for unused codes, a branch for scanning while already syncing. Each was defensible alone; together the feature became something the user called too complex for what it does. Asked, they kept the core and cut all of those.

**Rules:**
- Climb the ponytail ladder before adding UI states: can an existing message, action or rule cover this case? One message for every way sync stops beat four precise ones.
- When a fix adds a branch, name the simpler behaviour it replaces and ask whether that would do (e.g. "scanning always joins").
- Count a feature's states, not just its lines. If a sheet has more views than the task has steps, cut views.
