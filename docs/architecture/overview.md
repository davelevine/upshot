# Architecture

These pages cover how a story gets from a publisher's feed to the page, and what the reader does with it once it's there.

## How it fits together

<a href="diagram/upshot-architecture.html" target="_blank" rel="noopener" title="Open the interactive diagram"><img src="diagram/upshot-architecture.svg" alt="Upshot's architecture in four regions. Sources: CISA's catalog of exploited CVEs, 67 publisher feeds from feeds.opml, and Claude Haiku through the Claude Code CLI. GitHub: build.py runs hourly, fetches the feeds, reads the KEV catalog, scores each story with Claude, dedupes and flags; it hands new stories to extract.mjs (Readability) and commits data.json and rss.xml to the repository. Cloudflare: Workers Builds deploys the repository as the Site Worker, which serves the static site and answers /api/read from Workers KV, where extract.mjs stores article text for 100 days. The Site Worker reaches upshot-sync over a service binding, and upshot-sync keeps each reader's marks in a per-reader SQLite Durable Object. Browser: the page (index.html, app.js) is served over HTTPS by the Site Worker."></a>

How it's built and regenerated is in [diagram/README.md](diagram/README.md).

There's no server or database to look after. Upshot has three pieces:

1. **The build.** Every hour, a GitHub Actions job runs [`build.py`](../../build.py). It reads the feeds, has Claude Haiku score each new story, and keeps only the ones worth reading. It also extracts each article's text into Cloudflare KV for the reader. Then it commits a small JSON file and an RSS feed back to the repo.
2. **The Workers.** Cloudflare deploys the push. A Worker serves the static site, answers the reader's requests from KV, and starts the build on a cron trigger. A second Worker, `upshot-sync`, keeps what you've read the same across your devices, if you turn that on.
3. **The page.** Plain HTML and JavaScript, with no framework and no build step, that renders the JSON in a layout borrowed from desktop feed readers.

Everything else in these pages is detail on one of those three.

## The pages

- **[The pipeline](pipeline.md):** what the hourly build does, step by step, from fetching feeds to publishing.
- **[Exploited flags](exploited-flags.md):** how a story gets tagged **Exploited** or **Compromised**, and the checks behind those tags.
- **[The site](site.md):** the layout at each screen width, how lists and labels work, what counts as unread, and the pass that runs through the wordmark.
- **[The reader](reader.md):** how articles are extracted and stored, what the upshot bullets are, and what the reader does (and won't do) with your data.
- **[Typography](typography.md):** the licensed fonts, how they're tuned, and how they get to the page.
- **[Sync](sync.md):** keeping what you've read in step across devices with no account, and the designs I tried before this one.
- **[Hosting](hosting.md):** the Worker's configuration, how deploys happen, and how the build looks after itself.
