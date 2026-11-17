# The pipeline

The pipeline is everything the hourly build does to turn the feeds into the handful of stories the site shows. The Build workflow runs [`build.py`](../../build.py) every hour; the schedule is in [Configuration](../setup/configuration.md).

## Steps

1. **Fetch.** It reads every feed in [`feeds.opml`](../../feeds.opml). A broken feed is skipped, never fatal.
2. **Filter.** It keeps dated entries from the last few days that it hasn't seen before, capped per feed.
3. **Score.** Each new story goes to Claude Haiku (`claude-haiku-5-5`) on its own, through the Claude Code CLI, so its score never depends on what it was batched with. The model returns a category, a 1–10 relevance score within that category, a one-sentence summary, and whether the story reports an exploited flaw.
4. **Keep the notable ones.** A story is published if it clears its category's bar (`MIN_RELEVANCE` in [Configuration](../setup/configuration.md)) and isn't a repeat. There are no quotas, so a big security day shows as one and a slow day stays short. A 20-story daily cap exists only to catch a malfunction. Nothing published is taken down.
5. **Drop repeats.** The model flags a story already on the site from the past week, such as the same launch from another outlet. The code checks the claim, so one copy always survives.
6. **Flag exploited flaws.** See below.
7. **Pick the essentials.** Once a day, the model ranks the week's most important stories, and the top five become the essentials, no more than three from one topic. Each gets a line on what to do. For an exploited flaw the model is told its remedy, and a line that says to patch a flaw with no patch is replaced with one that fits it.
8. **Extract.** [`extract.mjs`](../../extract.mjs) stores each new story's text in Cloudflare KV for the reader, described in [The site](site.md).
9. **Publish.** The build writes [`site/data.json`](../../site/data.json) and [`site/rss.xml`](../../site/rss.xml), records seen URLs in `state.json`, and commits. An RSS item carries the summary, the upshot and, for an essential, what to do. Cloudflare deploys the push.

Anything older than 90 days is pruned.

## Exploited flags

A story about a flaw under active attack is tagged **Exploited**, with its remedy. An active supply-chain attack is tagged **Compromised**.

A story is flagged in one of two ways:

- **CISA lists it.** A CVE the story names is in CISA's [Known Exploited Vulnerabilities](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) catalog.
- **The story says so, and the quote checks out.** The model says a security story reports exploitation, a zero-day, an emergency patch or a supply-chain compromise, and quotes the words that say so. The code checks the quote is really in the story before trusting it, since a model can read a trend piece as an attack.

CVEs are taken from a story's title, excerpt, summary and upshot, never from the rest of the article, which often cites older flaws for background.

**Remedies** use CISA's terms: patch, mitigation only, or no patch yet. A CISA listing rules out "no patch yet", since the catalog only takes flaws with a remedy. Only an exploited flaw with no patch yet may publish below its category's bar.

**Compromised** follows GitHub and OSV, which keep malware apart from vulnerabilities. It has no patch status; what to do is in the upshot.

Later builds flag stories whose CVEs CISA lists afterward, and a repeat hands its flag to the copy on the site. RSS titles carry the label as a prefix ("Exploited: ", "Exploited, no patch yet: ", "Compromised: "), and each run summary counts the flags. If the catalog can't be read, the build carries on with the checked claims alone.

A URL in [`not-exploited.txt`](../../not-exploited.txt) is never flagged. That's how a wrong flag is retracted; see [Configuration](../setup/configuration.md).
