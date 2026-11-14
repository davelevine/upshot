# Upshot docs

These pages cover how Upshot works, how to run your own copy, and how to work on the code. Start with the [overview](architecture/overview.md) if you want the big picture, or [getting started](setup/getting-started.md) if you just want it running.

## How it works

- **[Overview](architecture/overview.md):** the whole thing on one page, from a publisher's feed to the story on your screen.
- **[The pipeline](architecture/pipeline.md):** what the hourly build does: fetching, scoring, dropping repeats, picking the essentials and publishing.
- **[Exploited flags](architecture/exploited-flags.md):** how a story gets tagged **Exploited** or **Compromised**, and how its patch status is worked out.
- **[The site](architecture/site.md):** the layout at each screen width, what the labels mean, how unread works, and the pass the wordmark makes on open.
- **[The reader](architecture/reader.md):** how articles are extracted and shown, and what it does (and doesn't do) with your data.
- **[Typography](architecture/typography.md):** the licensed fonts, how they're tuned, and how they get to the page.
- **[Sync](architecture/sync.md):** keeping what you've read the same across devices with a sync code, and the designs I tried first.
- **[Hosting](architecture/hosting.md):** the Worker, how deploys happen, and how the build looks after itself.

## Running your own copy

- **[Getting started](setup/getting-started.md):** the seven setup steps, about fifteen minutes.
- **[Feeds](setup/feeds.md):** adding a feed, backfilling, and retracting a wrong flag.
- **[Configuration](setup/configuration.md):** the knobs in `build.py`, and keeping the schedule on time.
- **[Optional extras](setup/optional.md):** the licensed fonts, Renovate, and notes on running sync.

## Working on the code

- **[Running locally](development/local.md):** the build, the dev server, and trying sync on a phone.
- **[Testing](development/testing.md):** unit tests, the browser smoke test, and things to know before changing the code.
- **[CI/CD](development/ci.md):** the workflows, deploys and secrets.
