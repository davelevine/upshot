# Architecture

Upshot is a static site whose data is rebuilt every hour. This page shows how the pieces fit together; the pages it links to explain each one.

## How it fits together

<img src="diagram/upshot-architecture.svg" alt="Upshot's architecture, read top to bottom along one spine: publisher feeds, the build, the repository, the Site Worker and the page. Arrows point the way data moves. 67 publisher feeds from feeds.opml send stories to the build (build.py and extract.mjs, hourly, on GitHub), with CISA's list of exploited CVEs coming in from the left and scores from Claude Haiku, through the Claude Code CLI, from the right. The build commits data.json and rss.xml to the repository and sends article text to Workers KV on Cloudflare, kept for 100 days. The repository deploys to the Site Worker (worker.js, cron at :17), which reads article text from KV for /api/read. The Site Worker and the page (index.html, app.js) share a two-way link: the site comes down over HTTPS and read state goes back up. The page keeps read state in this device's local storage. The Site Worker passes read state to upshot-sync, which keeps a Durable Object per reader and pushes the same read state to your other devices over a WebSocket.">

There's no server or database to look after. Upshot has three pieces:

1. **The build.** A GitHub Actions job runs `build.py` every hour. It fetches the feeds, has Claude Haiku score each new story, extracts the article text, and commits the stories worth reading as a small JSON file and RSS feeds. All the work happens in that one job, so nothing needs to stay running between builds. See [The pipeline](pipeline.md).
2. **The Workers.** Cloudflare deploys each push to the Site Worker, which serves the site and answers the reader from the article text the build stored in KV. Because the build does the extraction, the Worker never fetches from a publisher. A second Worker, `upshot-sync`, keeps read state the same across a reader's devices. See [Hosting](hosting.md) and [Sync](sync.md).
3. **The page.** Plain HTML and JavaScript render the JSON in a layout modeled on desktop feed readers. Read state stays in the browser unless the reader turns on sync. See [The site](site.md).
