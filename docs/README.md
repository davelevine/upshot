# Upshot docs

## How it works

- **[Overview](architecture/overview.md):** a diagram of the whole system and a short tour of its three pieces. Start here.
- **[The pipeline](architecture/pipeline.md):** how the hourly build turns the feeds into the stories on the site, including how a story gets flagged **Exploited**.
- **[The site](architecture/site.md):** what a reader sees and why: the layout, labels and unread state, the reader pane, and the fonts.
- **[Sync](architecture/sync.md):** how read state stays the same across a reader's devices without an account.
- **[Hosting](architecture/hosting.md):** the Cloudflare setup, deploys and secrets, and what happens when a build fails.

## Running your own copy

- **[Getting started](setup/getting-started.md):** set up your own copy, step by step.
- **[Configuration](setup/configuration.md):** tune a fork once it's running: score bars, schedule, feeds, fonts and Renovate.

## Working on the code

- **[Development](development.md):** run Upshot locally, run the tests, and what to know before you change the code.
