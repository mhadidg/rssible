<div align="center">

# RSSible

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-orange)](https://workers.cloudflare.com/)
[![Docker](https://img.shields.io/badge/run-Docker-blue)](https://www.docker.com/)

Paste a URL (HTML | JSON) + CSS selectors → RSS feed. Runs entirely on the *free tier*
of [Cloudflare Workers](https://workers.cloudflare.com/).

</div>

## How it works

At its core, **RSSible** takes a webpage link and CSS selectors and turns it into an RSS feed. Try this link:

> https://rssible.hadid.dev/feed?url=https://example.com&_item=div&title=h1&link=a&desc=p

The heavy lifting happens in a Cloudflare Worker using
the [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/) API. When you hit
`/feed`, the worker fetches the target URL, streams the HTML, and walks through it to extract feed items. Supported
selectors:

- `_item`: container for items (required)
- `title`: title of each item (optional if `link` is provided)
- `link`: link of each item (optional if `title` is provided)
- `desc`: description of each item (optional)
- `date`: publication date of each item (optional, must be parsable by JS `Date()`)

Optional `filters` param apply regex rules to include/exclude items. Also, optional `headers` param lets you pass
custom headers to the fetch request. It's inconvenient to set these params manually, use
the [app page](https://rssible.hadid.dev/).

> [!WARNING]
> The `headers` param is not encrypted; don't use it to pass secrets. If you need to access private links, consider
> local hosting (see below).

## JSON pages

JSON pages are also supported. Think of (public) APIs that return JSON, like:

- HN Algolia: https://hn.algolia.com/api/v1/search_by_date?numericFilters=points>100
- Reddit: https://www.reddit.com/r/programming/top/.json?t=week
- Github: https://api.github.com/users/sindresorhus/starred

To simplify things, JSON pages internally converted to a parsable HTML just enough for the `HTMLRewriter` to work on it.
JSON key-value pairs are converted to (nested) HTML `div` tags, where the class name match the JSON keys. Root object
has special `_root` class; array items `_item` class.

This JSON for example:

```json
{
  "posts": [
    {
      "title": "Post 1",
      "url": "https://example.com/post-1",
      "content": "This is post 1",
      "published_at": "2024-01-01T00:00:00Z"
    },
    {
      "title": "Post 2",
      "url": "https://example.com/post-2",
      "content": "This is post 2",
      "published_at": "2024-01-02T00:00:00Z"
    }
  ]
}
```

Would be converted to:

```html

<div class="_root">
  <div class="posts">
    <div class="_item">
      <div class="title">Post 1</div>
      <div class="url">https://example.com/post-1</div>
      <div class="content">This is post 1</div>
      <div class="published_at">2024-01-01T00:00:00Z</div>
    </div>
    <div class="_item">
      <div class="title">Post 2</div>
      <div class="url">https://example.com/post-2</div>
      <div class="content">This is post 2</div>
      <div class="published_at">2024-01-02T00:00:00Z</div>
    </div>
  </div>
</div>
```

As you may have guessed, you can use the same CSS selectors params for JSON links.

Use `?mirror=1` param to see the converted HTML version of a JSON page; here's an
example: [JSON page](https://api.agify.io/?name=dude);
converted [HTML version](http://rssible.hadid.dev/feed?url=https%3A%2F%2Fapi.agify.io%2F%3Fname%3Ddude&mirror=1).

## Deploy your own instance

You can run this for free on Cloudflare Workers. They offer generous free tier limits: 100,000 requests/day. Yes, 100k
as long as you keep it under 10ms CPU time per request. Static assets (`public/**`) are free and unlimited.

```bash
# Clone repo and navigate to it
git clone --depth 1 git@github.com:mhadidg/rssible.git && cd rssible

# Install Wrangler
npm i -D wrangler@latest

# Authenticate with Cloudflare
npx wrangler login

# Deploy to your account
npx wrangler deploy
```

Once deployed, you'll have a live endpoint:

```
https://rssible.your-subdomain.workers.dev
```

## Run locally with Docker

You can also run RSSible in a container, handy for local- or self-hosting. Host locally if you want to access private
links with auth headers.

```
# Navigate to project dir
cd rssible

# Build image
docker build -t rssible .

# Run container
docker run --rm -p 8787:8787 rssible
```

To keep the Docker container running locally (systemd) - start on boot, create a systemd unit file:

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
# Reload systemd to pick up new unit file
sudo systemctl daemon-reload

# Enable to start on boot
sudo systemctl enable rssible

# Start the service now
sudo systemctl start rssible
```

Check the logs to make sure things are all good:

```bash
sudo journalctl -u rssible.service -f
```

You've just made it like any other app on your system, except the UI is web-based on `http://localhost:8787`.

If are obsessed with desktop icons,
Chrome [supports shortcuts for web apps](https://support.google.com/chrome/answer/15085120). That's also the
case for most Chromium-based browsers (e.g., Brave).

## Demo links

See demo links on the [app page](https://rssible.hadid.dev/).

## Acknowledgments

This project was inspired by [Feedmaker](https://github.com/kevinschaul/feedmaker), and
uses [water.css](https://watercss.kognise.dev/) (CSS styles).

## License

MIT: free and open-source.
