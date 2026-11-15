# Architecture

These pages cover how a story gets from a publisher's feed to the page, and what the reader does with it once it's there.

## How it fits together

<a href="diagram/upshot-architecture.html" target="_blank" rel="noopener" title="Open the interactive diagram"><img src="diagram/upshot-architecture.svg" alt="Upshot's architecture, read top to bottom along one spine: publisher feeds, the build, the repository, the Site Worker and the page. Arrows point the way data moves. 67 publisher feeds from feeds.opml send stories to the build (build.py and extract.mjs, hourly, on GitHub), with CISA's list of exploited CVEs coming in from the left and scores from Claude Haiku, through the Claude Code CLI, from the right. The build commits data.json and rss.xml to the repository and sends article text to Workers KV on Cloudflare, kept for 100 days. The repository deploys to the Site Worker (worker.js, cron at :17), which reads article text from KV for /api/read. The Site Worker and the page (index.html, app.js) share a two-way link: the site comes down over HTTPS and read marks go back up. The page keeps read marks in this device's local storage. The Site Worker passes read marks to upshot-sync, which keeps a Durable Object per reader and pushes the same marks to your other devices over a WebSocket."></a>

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
