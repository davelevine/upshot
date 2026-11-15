# Architecture

These pages cover how a story gets from a publisher's feed to the page, and what the reader does with it once it's there.

## How it fits together

<a href="diagram/upshot-architecture.html" target="_blank" rel="noopener" title="Open the interactive diagram"><img src="diagram/upshot-architecture.svg" alt="Upshot's architecture in four regions. Sources: CISA's Known Exploited Vulnerabilities catalog, 67 publisher feeds from feeds.opml, and Claude Haiku (claude-haiku-5-5) through the Claude Code CLI. GitHub: the Build workflow (build.yml, dispatched by the Worker's cron) runs build.py, which fetches the feeds, reads the KEV catalog, makes one Claude call per story, and scores, dedupes, flags and picks essentials. build.py hands new stories to extract.mjs (Readability and linkedom), reports failing feeds to a self-closing Feed health issue, and commits data.json, rss.xml and state.json to the repository. A push that changes sync/ runs Deploy sync. Cloudflare: Workers Builds deploys every push to main, with PR previews, as the Site Worker (worker.js, cron at :17). extract.mjs stores article text in Workers KV (ARTICLES, 100-day TTL), which the Site Worker reads for /api/read. The Site Worker serves licensed fonts from the upshot-fonts R2 bucket, and reaches upshot-sync (/api/auth, /api/sync, rate limits) over the SYNC service binding and a WebSocket. upshot-sync keeps marks and devices in a per-reader SQLite Durable Object and one-time codes, good for 10 minutes, in a Codes Durable Object. Browser: the page (index.html, app.js) gets assets and data.json from the Site Worker, keeps read marks in local storage with no account, and renders articles in a sandboxed reader frame with a nonce-admitted relay script."></a>

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
