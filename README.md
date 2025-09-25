<div align="center">

# RSSible

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-orange)](https://workers.cloudflare.com/)
[![Docker](https://img.shields.io/badge/run-Docker-blue)](https://www.docker.com/)

Paste a URL + CSS selectors → get an RSS feed. Runs entirely on the *free tier*
of [Cloudflare Workers](https://workers.cloudflare.com/).

</div>

---

## How it works

At its core, **RSSible** takes a webpage link and turns it into an RSS feed.

The heavy lifting happens in a Cloudflare Worker using
the [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/) API. When you hit
`/feed`, the worker fetches the target URL, streams the HTML, and walks through it in a memory-efficient way. Selectors
you pass in (`_item`, `title`, `link`, `desc`, `date`) decide what to extract.

Optional filters apply regex rules to include/exclude items. The final feed is serialized into RSS XML on the fly, ready
for any RSS reader.

The browser UI (`public/**`) is just a helper. It lets you build query URLs visually, preview the first two items, and
copy the feed link. The `worker.js` is the Cloudflare Worker script.

---

## Deploy your own instance

You’ll need [Wrangler](https://developers.cloudflare.com/workers/wrangler/) installed.

```bash
# Install Wrangler if you haven't already
npm i -D wrangler@latest

# Authenticate with Cloudflare
npx wrangler login

# Deploy to your account
npx wrangler deploy
```

Config lives in [`wrangler.toml`](./wrangler.toml). Adjust the `name`, `routes`, and `custom_domain` for your setup.

Once deployed, you’ll have a live endpoint:

```
https://your-worker.your-subdomain.workers.dev
```

---

## Run locally with Docker

You can also run RSSible in a container, handy for local or self-hosting.

```
# Navigate to project dir
cd rssible

# Build image
docker build -t rssible .

# Run container
docker run --rm -p 8787:8787 rssible
```

Then visit `http://localhost:8787` in your browser.

## Keep it running locally (systemd)

To keep the Docker container running - start on boot, create a systemd unit file:

```bash
sudo tee /etc/systemd/system/rssible.service <<'EOF'
[Unit]
Description=RSSible
After=network.target docker.service
Requires=docker.service

[Service]
Restart=always
ExecStart=/usr/bin/docker run --rm -p 8787:8787 --name rssible rssible
ExecStop=/usr/bin/docker stop rssible

[Install]
WantedBy=multi-user.target
EOF
```

Then enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable rssible
sudo systemctl start rssible
```

Check the logs to make sure things are all good:

```bash
sudo journalctl -u rssible -f
```

That's it. You've just made it like any other app on your system; except the UI is web-based.

---

## Showcase examples

See demo links on the [project homepage](https://rssible.hadid.dev/).

---

## License

MIT: free and open-source.
