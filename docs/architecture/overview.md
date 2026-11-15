# Architecture

These pages cover how a story gets from a publisher's feed to the page, and what the reader does with it once it's there.

## How it fits together

<img src="diagram/upshot-architecture.svg" alt="Upshot's architecture, read top to bottom along one spine: publisher feeds, the build, the repository, the Site Worker and the page. Arrows point the way data moves. 67 publisher feeds from feeds.opml send stories to the build (build.py and extract.mjs, hourly, on GitHub), with CISA's list of exploited CVEs coming in from the left and scores from Claude Haiku, through the Claude Code CLI, from the right. The build commits data.json and rss.xml to the repository and sends article text to Workers KV on Cloudflare, kept for 100 days. The repository deploys to the Site Worker (worker.js, cron at :17), which reads article text from KV for /api/read. The Site Worker and the page (index.html, app.js) share a two-way link: the site comes down over HTTPS and read state goes back up. The page keeps read state in this device's local storage. The Site Worker passes read state to upshot-sync, which keeps a Durable Object per reader and pushes the same read state to your other devices over a WebSocket.">

How it's built and regenerated is in [diagram/README.md](diagram/README.md).

There's no server or database to look after. Upshot has three pieces:

1. **The build.** Every hour, a GitHub Actions job runs [`build.py`](../../build.py). It reads the feeds, has Claude Haiku score each new story, keeps the ones worth reading, stores each article's text in Cloudflare KV, and commits a small JSON file and an RSS feed. See [The pipeline](pipeline.md).
2. **The Workers.** Cloudflare deploys each push. The Site Worker serves the static site, answers the reader's requests from KV, and starts the build on a cron trigger. A second Worker, `upshot-sync`, keeps what you've read the same across your devices if you turn sync on. See [Hosting](hosting.md) and [Sync](sync.md).
3. **The page.** Plain HTML and JavaScript, with no framework and no build step, rendering the JSON in a layout borrowed from desktop feed readers. See [The site](site.md).
