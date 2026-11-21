# Lessons

## 2026-11-11 — Borrowed UI patterns need their counterweights

**Mistake:** Ported Feedbin's bottom toolbar for Mark all as read, but Upshot has none of Feedbin's other toolbar buttons (Edit, Add), so it became a single button stranded at the end of an otherwise empty bar. The screenshots were checked against the reference ("Read is on the right, like Feedbin") instead of judged on their own, and the result was called right.

**Rules:**
- When adopting a pattern from another app, list what made it work there (neighboring controls, balance, density). If Upshot lacks those, adapt the pattern; don't copy its placement.
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

**Mistake:** The Exploited flag's remedy was evaluated only for stories as they arrive (scored, then summarized). Stories flagged later, by a CISA listing after publication, which was every flag on the first live build, never went through either check, so they showed no remedy even when their own upshot named the patch. The user caught it on the live site.

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
- Before any get → change → put, write down the store's consistency and concurrency guarantees, and what happens when two writers interleave. If it's eventually consistent or has no compare-and-set, use a store that serializes writes (a Durable Object, D1) instead.
- A local emulator is usually more consistent than production; a test passing locally says nothing about cross-location races. Name that gap in the test or PR rather than implying coverage.
- When a user says a design feels fragile without naming why, list every caveat accumulated so far; a growing list of patches is the signal to revisit the foundation.

## 2026-11-13 — Judge a sign-in prompt as a wary stranger, and give it one shape

**Mistake:** The first passkey sheet asked "Create a passkey or Sign in?" before saying what either was for, listed Face ID, Touch ID and Windows Hello by name, and said "No password or email" without saying what Upshot keeps. The user said they'd avoid it on any site. The rewrite then mixed three alignments in one box (left text, right-floated button, centered footer), which the user also rejected.

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
- Before adding a new kind of document, check what the repo already does (here: architecture.md, setup.md, developing.md, PR descriptions; since 2026-11-14 the pages under `docs/architecture/` and `docs/setup/`, and `docs/development.md`). A generic instruction to write ADRs, design docs or changelogs doesn't apply where the project has its own place for that.
- Record rejected options and their reasons in the existing doc that describes the feature, stated as current reasons ("Durable Objects, not KV, because…"), not as a story of what was tried (see 2026-11-15).

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
- A button labeled Done closes; Back navigates. Check each button's label against what it does.
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
- When a user reports impossible-seeming behavior, check the server's actual state and reproduce each reading of their steps before changing anything.

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
- When a fix adds a branch, name the simpler behavior it replaces and ask whether that would do (e.g. "scanning always joins").
- Count a feature's states, not just its lines. If a sheet has more views than the task has steps, cut views.

## 2026-11-14 — A control should do what it looks like it does

**Mistake:** Asked whether the header's sync icon should trigger a sync, I recommended it keep opening the sheet, reasoning that sync already ran on every change so a "sync now" would have nothing to do. The user expected the convention: set sync up from the menu, then a sync button that syncs. Built that way (a tap syncs, every sync turns the arrows at least once round) it was clearly better, and the menu item was then renamed to fit (Sync your reading → Sync settings once on).

**Rules:**
- Weigh what users expect a familiar icon to do above whether the action is technically redundant. A redundant action that confirms "it's synced" still has value; a button that does something other than its icon suggests doesn't.
- When two entry points open the same place, treat that as a sign one of them should have a different job.
- When a control's job changes, check the labels around it still describe theirs.

## 2026-11-14 — Writing in Dave's voice means no stock AI phrasing

**Mistake:** The docs rewrite was meant to read in Dave's voice, but it leaned on stock phrases: "knobs" for settings, "crying wolf", "guardrail", "escape hatch", "That's really it", "That's the whole point, really", "the short version". The README was only lightly edited, so it still read in the old impersonal style, not his. The PR title also described the work as a rewrite "in the author's voice".

**Rules:**
- Name things plainly: settings, not knobs or levers; "how a wrong flag gets retracted", not an escape hatch. No idioms used as filler (crying wolf, heavy lifting, under the hood), and no throwaway closers ("That's really it", "the whole point, really", "In short").
- Before calling a voice pass done, grep the result for those phrases, and read it next to one of his posts (portfolio-v2 `secrets-at-deploy-time.md`). Voice comes from first person and his reasons, not from colorful wording.
- A voice pass covers every file in scope, including the README. Don't treat a file as finished just because it was already close.
- Never describe the work as being "in the author's voice" (or similar) in commits, PRs or docs. Describe what changed.

## 2026-11-14 — Docs aren't blog posts: borrow the voice, not the register

**Mistake:** After being asked for Dave's voice, the README and docs were written like his blog posts: hook openings ("the one kind of story you shouldn't have to go looking for"), asides ("which was a big part of the appeal for me", "I'd rather look at those myself") and chatty pointers ("If you'd like your own…"). He said the README read like a blog post, and that these are not blog posts.

**Rules:**
- In a README or reference doc, voice means plain words and his punctuation, not his blog's register. Lead with what the page covers, in one or two sentences. Use lists and numbered steps where the content is a list or a sequence.
- Use first person only for a decision and its reason (a design set aside, why the build does the parsing). Leave out feelings, preferences and hooks.
- A README is a summary that links to the docs: what it is, its features, how it works in a few steps, where to go next.

## 2026-11-14 — American English everywhere

**Mistake:** The docs, code comments and lessons had British spellings (colour, behaviour, centred, labelled, summarise). When "colour" turned up in the old docs, I took it as the house style and wrote "summarise" into the architecture diagram to match. The user stopped the work: nothing should use British English.

**Rules:**
- Write American English in every file: docs, comments, test names, commit messages, PR text and diagrams (color, behavior, center, labeled, canceled, summarize, license as a noun).
- A spelling already in the repo isn't a style guide. If it's British, fix it; don't copy it.
- Leave API names as they are: GitHub Actions' `cancelled()`, `aria-labelledby`, and quoted third-party text in test fixtures.

## 2026-11-14 — Match a reference's level of detail, not just its look

**Mistake:** Asked for more detail in the architecture diagram, and pointed at homelab-iac for reference, I copied homelab-iac's style but went to 19 boxes and 20 connections. Its diagrams are about 14 boxes and 10 connections, and its README says the scope is deliberately small. The user said it was now too much.

**Rules:**
- When given a reference, measure its density (boxes, connections, sublabel length, number of cards) and stay within it. "More detail" means more than the last version, up to the reference's level, not everything that exists.
- Before adding a box, ask whether a reader of the overview needs it. Leave secondary parts (deploy helpers, issue bots, storage details) to the pages that cover them.
- The reading order (left to right, top to bottom) must follow the flow. Put the real starting point first and run the main path as one straight spine; side inputs and services branch off it. The first version put CISA top-left, so it read as the start of everything.

## 2026-11-15 — Docs describe the current state only

**Mistake:** The rewritten docs kept passages of history: "I tried a cloud first" for the sync icon, "Söhne replaced Public Sans" and "as wide as Public Sans was", a one-time backfill that ran when the Exploited flag shipped, and a "Designs I set aside" section. The user said the docs should only discuss the current state.

**Rules:**
- Docs say what the system is and why, not how it got there. History lives in commits and PRs.
- Keep a reason only if it explains the current design, and state it in the present tense ("Sync codes, not passkeys, because…"). Drop it if it only explains a past choice.
- Before handing over docs, grep for history wording: tried, first, replaced, was, were, used to, shipped, before, set aside, as before.

## 2026-11-15 — Each fact lives on one page

**Mistake:** After the docs were cut down, they still said the same things in several places: the diagram's own README repeated the overview, the README and getting-started both stated the cost, the overview re-described what each page opens with, the pipeline repeated the configuration table's score bars, and page openings ("This page covers…") repeated the index. A keyword check by topic missed most of it.

**Rules:**
- Give each fact one owner page. Anywhere else, link to it; don't summarize it again.
- An index lists topics, and a page doesn't announce its own contents. Overview and summary pages point; they don't re-explain.
- Check for repetition at the sentence level, not by topic keywords: run `/tmp/docscheck/repeats.py` (sentences on different pages sharing a six-word run) and resolve every hit or confirm it's a coincidence.
- Before adding a new doc file, ask whether its content already has an owner page.
- **Amended the same day: don't over-apply this.** The next pass removed orientation along with the copies: the README lost "How it works" and its prerequisites, pages lost their introductions, the index became keyword fragments, and the user said the docs got worse. The rule is about **specifics** (values, limits, schedules, commands, file layouts), which drift when copied. **Orientation repeats on purpose**, shorter at each level: the README summarizes in a few sentences, the overview in a paragraph per piece, and the page has the detail. Every page opens with a sentence or two on what it's for, and a how-to lists its own prerequisites (Diátaxis, the Google developer documentation style guide, standard README sections).
- When the user gives a rule, apply it with judgment against established practice, and say where the line falls before applying it everywhere.

## 2026-11-15 — Docs cover the project, not the tools around it

**Mistake:** `development.md` carried a section on regenerating the architecture diagram with Archify: render HTML, export an SVG, lock it to dark. The user pointed out it has nothing to do with Upshot itself.

**Rules:**
- Document how the project works and how to run or change it. A third-party tool's workflow (diagram generators, editors, formatters) doesn't belong in the docs; the committed source file is enough.
- Before adding a section, ask whether a reader working on the project would need it, or only someone repeating a task I just did.

## 2026-11-16 — Trace the real path before blaming a component

**Mistake:** Asked whether an upshot could come from the excerpt, I said Hacker News stories have no reader text because hnrss carries only the link and points. The user asked whether hnrss really stops the reader, and it doesn't: the reader fetches the linked article itself, and 13 of 18 HN stories had reader text. I had also offered a local "The reader view isn't ready yet" screenshot as evidence about the live site, when the local article store is simply empty.

**Rules:**
- Before saying why something fails, trace where its input really comes from (here, `extract.mjs` fetches the article URL; the feed only supplies the excerpt) and check the data (`minutes > 0` per publisher) instead of reasoning from one example.
- A local `wrangler dev` has an empty article store, so its reader says nothing about production. Don't use it as evidence for how a live story behaves.
- When asked "it used to work", look for the record before answering, and say plainly when the repo has none.

## 2026-11-16 — Reproduce the screen the user describes before explaining it

**Mistake:** The user said the sync icon looked crossed out with search open on a phone. The slash matched the sync error icon, so I explained it as a failed sync during a preview reload and offered an automatic retry. The user said it happened every time search opened. It wasn't sync at all: on phones the search panel's close ✕ is fixed at `right: 64px` to cover the search icon, and with sync on the sync button takes that slot, so the ✕ was drawn over the sync arrows.

**Rules:**
- When the user reports how something looks, reproduce that exact screen (same width, same state, same steps) before offering a cause. A matching icon in the code isn't evidence that it's the one on screen.
- When a report names a trigger ("when search opens"), test that trigger first; a cause that ignores it is probably wrong.
- Anything positioned to cover another control (`position: fixed` at a set offset) must be checked with every optional neighbor present: sync on and off, the reader open and closed.

## 2026-11-16 — Copy the reference UI's structure, not just its idea

**Mistake:** Asked to move reader buttons into a submenu "like Feedbin's", I built a short list (four A's, then "Dark mode" and "Full screen" rows) from a text description of Feedbin's features. The user said it wasn't the answer and sent a screenshot: Feedbin's Format panel has headed sections (Theme as swatches, a Smaller/Larger pair, Display with switches showing their shortcut), and the Format button sits last in the bar.

**Rules:**
- When the user names another product's UI as the model, get a look at that UI (ask for a screenshot if there isn't one) before building, and match its structure: sections, headings, control types, order, placement.
- Say which parts of the model are left out and why (here, Typeface and extra themes), rather than quietly building a smaller version.
- **Amended the same day:** the literal copy was rejected too ("way too literal like Feedbin"). The model sets what the menu holds and roughly where it goes; the look comes from Upshot's own components (here, the Share menu's rows). When a request names a model but the taste is unclear, offer two or three concrete directions with previews before building, not after two misses.
- When the user's words don't match what the code shows ("the sync button in the article view" when the phone reader has none), reproduce it with the user's state (sync on, phone width) and state the reading taken: here it was the story list's header.

## 2026-11-16 — Reproduce at the user's sizes, and get the recording early

**Mistake:** The user reported that full screen made the story slide into place. I reproduced at 1440px, where the reader pane is 759px wide, saw nothing, and built a fix for a guessed cause (a cross-process frame showing its old layout). It changed the symptom from "slides right" to "drops down". Their screen recording showed a pane under 600px: the article frame's phone padding (18px sides, 24px top) changes at 600px, and the `transition` I had put on `main`'s padding, meant for fluid width, animated that change on every resize.

**Rules:**
- When a visual bug doesn't reproduce, ask for a screen recording (or the window size and settings) before guessing a cause. Measure the panes in the recording first.
- Test layout changes across breakpoints, including the article frame's own (600px) and the page's (640, 1024, 1280, 1440), not only at one desktop width.
- Scope transitions to the change that should animate (a class set for that change), not to the element: a transition on a property that media queries also change animates every resize.
- A `.mov` from macOS can't be decoded by Playwright's ffmpeg; an H.264 `.mp4` plays in Playwright's Chromium, and frames come from seeking the `<video>` and taking screenshots (a `file://` canvas is tainted).

## 2026-11-18 — Don't make a link change where it goes with the view

**Mistake:** Asked how the UI would offer per-section RSS feeds, I proposed making the menu's one "RSS feed" link follow the current list (Essentials feed on Essentials, the full feed elsewhere). The user said that isn't intuitive and asked for an "RSS feeds" item with a submenu that lists each feed.

**Rules:**
- A control whose target silently depends on the view state is hidden behavior. When there are several destinations, list them all where they can be seen (a submenu, a list), each with its own name.
- Prefer the familiar pattern (a submenu of choices) over a clever one that saves a menu row.
- **Amended the same day:** asked for "hover and a submenu appears", I built a flyout. The menu sits at the screen's right edge, so the flyout opened to the left while its arrow pointed right, and the user asked for a click that opens the list under the row instead. Before building a submenu, check where it can open from the menu's position and whether the arrow matches; when the literal request leads somewhere awkward, say so and show the in-place option first.

## 2026-11-18 — Research practice before citing it, and trace a late item to its source

**Mistake:** Asked how other readers order stories that arrive late, I answered from memory ("Feedbin sorts by publish date", "Miniflux lets you choose") and recommended from that. The user asked for real homework, and asked why the story took a day, which I hadn't checked. The feed's own history answered it: the community scraper (Olshansk/rss-feeds) didn't add the story until 18:36 UTC, and Upshot took it on the next build.

**Rules:**
- When asked what's standard, search and cite sources before answering; name the products whose behavior couldn't be confirmed instead of filling in from memory.
- When something shows up late, find when it first appeared upstream (the feed's git history, its `lastBuildDate`) before explaining or redesigning around it.
- **Amended the same day:** the user picked arrival order and arrival-age stamps from a text preview, then rejected the built version on sight ("feels so odd"). For a change to how the main list looks or orders, put it in the preview on real data before writing tests and docs, and show that before asking for a final choice.

## 2026-11-19 — Look for the infrastructure code before handing over dashboard steps

**Mistake:** Wrangler's login couldn't manage R2 or the zone, so I wrote out eight Cloudflare dashboard steps for the audio bucket (bucket, domain, lifecycle, CORS, WAF and cache rules, billing alert, token scope). The user pointed out that `homelab-iac` manages Cloudflare as OpenTofu, and its rulesets own their phases, so dashboard rules would have been reverted on the next apply. Writing the setup as code there also found what the dashboard steps missed: the zone's generated WAF rules challenge non-US visitors on any host not skipped, which would have silently stopped `<audio>` outside the US.

**Rules:**
- Before giving the user manual steps for a cloud service, search their other repos (`~/downloads/github/`) for infrastructure code that manages it, and ask if none turns up. Change the code, not the dashboard.
- When adding a host to a zone, read the zone's existing WAF, cache and redirect rules for what they'll do to it, not just the rules being added.

**Also this day, unprompted:** I told the user the audio backfill would take "a few hours" without multiplying it out; it was about 16 runner-hours, and I corrected it after the run had started. A duration or cost estimate is arithmetic on real data (`data.json`, measured rates), done before it's stated, never a feel.

## 2026-11-20: "Fix the way it looks" meant one detail, not a redesign

Asked to fix how "1 unpatched" looked in the sidebar, I guessed and restyled it twice (a filled red pill, then a count-only badge) before the user said only the gap between the number and the word was wrong.

**Rules:**
- On a vague visual complaint, zoom into the user's screenshot first and name the specific defect before changing anything. If more than one reading fits, ask which one they mean instead of redesigning.
- Check typography claims against the real font file (fontTools, HarfBuzz) before writing CSS based on them.

## 2026-11-20: Find every consumer of a credential before suggesting a rotation, and check the deploy after a merge

**Mistake:** While moving secrets into the GitHub `production` environment, I suggested rolling `CF_API_TOKEN` without checking what else used it. Workers Builds deployed the site with the same token, so every deploy and PR preview failed from 18:40 UTC and the live site stayed on the 17:27 build for over two hours. I said the merges were done after checking only Actions, not the `Workers Builds: upshot` check, and the user found the failures. A second roll, and a Cloudflare value put into `GITHUB_DISPATCH_TOKEN` (a GitHub PAT), made it worse before Workers Builds got a token of its own.

**Rules:**
- Before suggesting that a token be rolled or deleted, list everything that holds a copy of it (GitHub secrets, Workers Builds' build token, Worker secrets) and say which will break. Prefer one token per consumer.
- When a fix involves several credentials, give a table of each one: what it is, where it lives, and which service issues it.
- After a merge or a credential change, confirm the deploy: the `Workers Builds: upshot` check on `main` and the live `upshot.me/data.json` `generated_at`. Green Actions don't mean the site deployed.
- After opening a PR, check its CI before reporting the work as done.
- Before deleting a token that looks unused, find out what holds its value. "No trigger uses it" isn't enough: on the same day I deleted three Workers Builds build tokens that no trigger referenced, and one held the value GitHub's `CF_API_TOKEN` used, so the next build got `KV 401`. Cloudflare's "last used" time on each token shows which one a consumer really uses.
- When a credential starts failing after a change, first check which token the consumer is actually using ("last used" times, the token behind each secret) before changing permissions. I took that 401 for a scoping problem and trimmed a token nothing used.
- Workers Builds copies **Previews Base** into each branch's own trigger on its first build, so changing Previews Base doesn't fix a branch that already exists; that branch's trigger has to be updated (or the branch rebuilt fresh).
- Give every time in Eastern (EST/EDT) with AM/PM, never UTC.

## 2026-11-21 — Read the reference's code before saying how it behaves

**Mistake:** Shown a screenshot of Feedbin's mobile search, I said Feedbin dims the list behind the search drawer and offered that as the answer to the list looking tappable. Feedbin's source showed the gray titles were only read stories (`.entry-summary.read`): its drawer sits in the page, and the list stays live. The first plan (an overlay drawer over a faded list) rested on the wrong reading. Earlier the same day, a full-screen design and an empty-state mark were built before the user, seeing them, questioned whether "Recently read" earned its place; the mockups helped, but each choice still came one step late.

**Rules:**
- When a reference app is open source, read the code that builds the UI before describing its behavior or designing around it; a screenshot can't tell styling apart from state.
- When reading a screenshot, name the other explanations for what's visible (read state, hover, selection) before picking one.
- Mock each candidate on real data, with the keyboard's height in view on a phone, before building it; the side-by-side mockups settled questions text couldn't.

## 2026-11-21 — Describe the change on its own terms, not as another app's copy

**Mistake:** The PR for in-place phone search had "as Feedbin does" in its title, opened by saying it "works as Feedbin's mobile search does (checked against Feedbin's source…)", and listed what was "not taken from Feedbin". The site doc's new section began "search works as in Feedbin". The user said the PR didn't need to read like a blatant Feedbin ripoff.

**Rules:**
- In PR titles, PR bodies, commit messages and docs, describe what Upshot does and why. A reference app may have informed the design; that belongs in the conversation, not in public write-ups.
- Don't list what was "left out" of another app's feature; list what Upshot doesn't do only when a reader would otherwise expect it.
