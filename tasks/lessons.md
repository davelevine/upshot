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
