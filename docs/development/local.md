# Running locally

This page covers running Upshot on your own machine: the pipeline that builds the data, and the site that shows it. Tests are covered in [Testing](testing.md), and the workflows that run them are in [CI/CD](ci.md).

## Setting up

You'll need a Python virtual environment for the pipeline and the npm packages for the site:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
npm ci
```

## Running the pipeline

The build needs the Claude Code CLI (`npm i -g @anthropic-ai/claude-code`) and a token from your subscription:

```bash
CLAUDE_CODE_OAUTH_TOKEN=... .venv/bin/python build.py
```

Keep in mind that it writes real data. Don't commit a local run's output unless you mean to.

## Serving the site

The reader needs the Workers runtime, so a plain static server won't do. Use Wrangler instead:

```bash
npx wrangler dev -c wrangler.jsonc -c sync/wrangler.jsonc --infer-origin-from-routes=false --port 8788
```

A few things about those flags:

- **The two `-c` flags** run the site's Worker and `upshot-sync` (`sync/`, read-state sync) together, connected the same way they are when deployed.
- **`--infer-origin-from-routes=false`** lets the Worker see the address you actually opened rather than the live domain. Its same-origin check depends on that.

Sync's session cookie is `Secure`, and browsers only waive that for `localhost`. An IP address such as `127.0.0.1`, or a plain-HTTP Tailscale address, will serve the site just fine, but it can't turn sync on.

## Trying sync on a phone

To test sync on a phone, serve it over HTTPS on your tailnet. First, run the dev server with HTTPS too, by adding `--local-protocol https --upstream-protocol https` to the command above. Then:

```bash
tailscale serve --bg --https=10443 https+insecure://localhost:8788
```

It'll be at `https://<machine>.<tailnet>.ts.net:10443`, and only reachable from your tailnet. HTTPS certificates have to be enabled on the tailnet for this to work. When you're done, `tailscale serve --https=10443 off` stops it.

## Fonts

The site's fonts, Söhne, Mercury Text and Mercury Display, are licensed, so they aren't in the repo; the Worker serves them from R2 (see [Typography](../architecture/typography.md)). `wrangler dev` uses a local, empty copy of the bucket, so you'll see the system fonts until you load the fonts into it. If you have them, it's a one-time step:

```bash
for f in /path/to/fonts/{Sohne,Mercury}-*.woff2; do npx wrangler r2 object put "upshot-fonts/$(basename "$f")" --file "$f" --content-type font/woff2 --local; done
```

They stay in `.wrangler/state`. A second server started with its own `--persist-to` has its own copy, so it needs the same step with that flag added.
