/**
 * Optimized URL/HTML → RSS generator (Cloudflare workers runtime)
 * - Static assets served via ASSETS binding (wrangler.toml)
 * - Worker handles /feed and a minimal /favicon.ico
 * - Lite mode (default): title+link only (fastest)
 * - Full mode: also description/date (slower)
 */

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // Handle favicon quickly
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });

    // All non-/feed requests go to public/
    if (url.pathname !== "/feed") {
      return env.ASSETS.fetch(req);
    }

    try {
      return await handleFeed(req);
    } catch (e) {
      const status = e?.status || 500;
      return new Response(e?.message || "Internal Error", { status });
    }
  },
};

const DEFAULT_LIMIT = 5; // items per feed
const MAX_LIMIT = 25; // max items per feed
const CACHE_TTL = 300; // in seconds; 5 minutes

const DISABLE_CACHE = true; // for testing
const DEBUG = true; // for debugging

if (!DEBUG) {
  console.log = () => {};
}

function safeCap(text, maxChars) {
  if (!text) return "";
  if (text.length <= maxChars) return text.trim();
  return text.slice(0, maxChars).trim();
}

async function handleFeed(req) {
  const url = new URL(req.url);
  const params = parseParams(url.searchParams);

  // Caching; key includes params
  let cache, cacheKey;
  if (!DISABLE_CACHE) {
    cache = caches.default;
    cacheKey = new Request(url.toString(), req);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const defaultHeaders = {
    'User-Agent': 'RSSible/1.0 (+https://rssible.mhadidg.com/)', //
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  // NOTE: network wait not counted in CPU time
  const upstream = await fetch(params.url, {
    redirect: "follow", //
    signal: AbortSignal.timeout(3_000), //
    headers: { ...defaultHeaders, ...params.headers }, // params override
  }).catch((error) => {
    throw http(502, `Page fetch error: ${error.message}`);
  });

  if (!upstream.ok) throw http(502, `Upstream ${upstream.status}`);

  const t0 = performance.now(); // start CPU timing
  const items = await extractItems(upstream, params);
  const rssXml = buildRss({ params, items });
  const t1 = performance.now(); // end CPU timing

  console.log(JSON.stringify({
    "cpu-time": +(t1 - t0).toFixed(3), //
    count: items.length, //
    mode: params.mode,
  }));

  const res = new Response(rssXml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8", //
      // "cache-control": `public, max-age=${CACHE_TTL}`,
    },
  });

  if (!DISABLE_CACHE) {
    await cache.put(cacheKey, res.clone());
  }

  return res;
}

function parseParams(query) {
  const url = (query.get("url") || "").trim();
  const item = (query.get("_item") || "").trim();
  if (!url || !item) throw http(400, "Query params 'url' and 'item' are required");

  // Default to "lite" mode (title & link only)
  const modeRaw = (query.get("mode") || "lite").toLowerCase();
  const mode = (modeRaw === "full") ? "full" : (modeRaw === "advanced" ? "advanced" : "lite");

  const title = trim(query.get("title"));
  const link = trim(query.get("link"));
  if (!title && !link) throw http(400, "Provide at least one selector: 'title' or 'link'.");

  // In lite mode, ignore desc/date entirely (less CPU time)
  const desc = (mode !== "lite") ? trim(query.get("desc")) : undefined;
  const date = (mode !== "lite") ? trim(query.get("date")) : undefined;

  // Accept weird formats, like OxFF or 1e1
  const limitRaw = Number(query.get("limit") || DEFAULT_LIMIT);
  const limit = Math.min(isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, MAX_LIMIT);

  const streamRaw = (query.get("stream") || "on").toLowerCase();
  const stream = !(streamRaw === "off");

  let headers;
  // Base64-encoded RFC-style headers block
  const headersB64 = trim(query.get("headers"));
  if (mode === "advanced" && headersB64) {
    try {
      const raw = decodeB64(headersB64);
      // Converts to { name: value, ... }
      headers = sanitizeHeaders(parseHeaders(raw));
    } catch (e) {
      throw http(400, "Invalid 'headers' parameter (base64 or header lines).");
    }
  }

  // Compiles to array of { field, regex }
  const filterRaw = trim(query.get("filters")); // one textarea; multiple lines
  console.log(`Filters: ${JSON.stringify(filterRaw)}`);
  const filters = filterRaw ? parseFilters(filterRaw) : undefined;

  return { url, item, title, link, desc, date, mode, limit, stream, headers, filters };
}

async function extractItems(upstream, params) {
  const items = [];
  let current = null;

  // Cap to cut long strings
  const CAP_TITLE = 128;
  const CAP_DESC = 1024;
  const CAP_DATE = 64;
  const CAP_ITEMTEXT = 2048; // item-level text captured for filtering

  const rewriter = new HTMLRewriter().on(params.item, {
    element(elem) {
      if (items.length >= params.limit) return;

      current = { _text: "" };
      elem.onEndTag(() => {
        const match = matchFilters(current, params.filters, current._text);
        if ((current.title || current.link) && match) {
          items.push(current);
        }

        current = {}; // reset for next item
      });
    },

    text(text) {
      if (!params.filters.item) return;
      if (!current || items.length >= params.limit) return;
      if (current._text && current._text.length >= CAP_ITEMTEXT) return;

      const chunk = text.text;
      if (chunk) current._text = safeCap((current._text || "") + chunk, CAP_ITEMTEXT);
    },
  });

  if (params.title) {
    rewriter.on(`${params.item} ${params.title}`, {
      text(text) {
        if (current.title || items.length >= params.limit) return;

        const value = safeCap(text.text, CAP_TITLE);
        if (value) current.title = value;
      },
    });
  }

  if (params.link) {
    rewriter.on(`${params.item} ${params.link}`, {
      element(elem) {
        if (current.link || items.length >= params.limit) return

        let href = elem.getAttribute("href");
        if (href && href.startsWith('/')) {
          href = new URL(params.url).origin + href;
        }

        if (href) current.link = href;
      },
    });
  }

  if (params.desc) {
    rewriter.on(`${params.item} ${params.desc}`, {
      text(text) {
        if (current.desc || items.length >= params.limit) return;

        const value = safeCap(text.text, CAP_DESC);
        if (value) current.desc = value;
      },
    });
  }

  if (params.date) {
    rewriter.on(`${params.item} ${params.date}`, {
      text(text) {
        if (current.pubDate || items.length >= params.limit) return;

        const value = safeCap(text.text, CAP_DATE);
        if (value) current.pubDate = new Date(value).toISOString();
      },
    });
  }

  const transformed = rewriter.transform(upstream);
  if (params.stream) {
    // HTMLRewriter runs a streaming HTML tokenizer/parser
    // over a byte stream. It keeps its own internal buffer
    // so that tag/text boundaries may span chunks.
    const reader = transformed.body.getReader();
    while (true) {
      // Pulls in chunks; controlled by producer
      const { done } = await reader.read();
      if (done || (items.length >= params.limit)) break;
    }
  } else {
    // Read entire body once
    await transformed.text();
  }

  return items;
}

function buildRss({ params, items }) {
  const now = new Date().toUTCString();
  const { origin, host } = new URL(params.url);

  let out = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(host)}</title>
    <link>${esc(params.url)}</link>
    <generator>Feedmaker</generator>
    <ttl>${CACHE_TTL / 60}</ttl>
    <image>
      <url>${origin}/favicon.ico</url>
    </image>
    <lastBuildDate>${now}</lastBuildDate>`;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    out += "\n" + indent("<item>", 4);
    if (it.title) out += "\n" + indent(`<title>${esc(it.title)}</title>`, 6);
    if (it.link) out += "\n" + indent(`<link>${esc(it.link)}</link>`, 6);
    if (it.desc) out += "\n" + indent(`<description><![CDATA[${it.desc}]]></description>`, 6);
    if (it.pubDate) out += "\n" + indent(`<pubDate>${it.pubDate}</pubDate>`, 6);
    if (it.link) out += "\n" + indent(`<guid isPermaLink="true">${esc(it.link)}</guid>`, 6);
    out += "\n" + indent("</item>", 4);
  }

  out += "\n" + indent("</channel>", 2);
  out += "\n</rss>";
  return out;
}

function indent(str, n) {
  return " ".repeat(n) + str;
}

// CPU-friendly escape
function esc(str) {
  str = String(str);
  // Early exit when no escapables present (avoids regex work)
  if (str.indexOf("<") === -1 && str.indexOf(">") === -1 && str.indexOf("&") === -1) return str;
  return str.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

function trim(s) {
  return (s && s.trim()) || undefined;
}

function http(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function decodeB64(rawB64) {
  // matches client-side btoa(raw)
  return atob(rawB64);
}

function parseHeaders(block) {
  const out = {};
  // RFC-style lines: "Name: value"
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue; // skip empty

    const idx = line.indexOf(":");
    if (idx <= 0) continue; // skip malformed

    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!name) continue; // allow empty value

    out[name] = value;
  }

  return out;
}

function sanitizeHeaders(headers) {
  if (!headers) return undefined;

  const drop = new Set([
    "connection",
    "proxy-connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "te",
    "host",
    "content-length",
    "content-encoding",
    "proxy-authorization"
  ]);

  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (drop.has(lower)) continue;
    out[k] = v;
  }

  return Object.keys(out).length ? out : undefined;
}

// Supported keys: item, title, link, desc (date not unsupported)
// Block lines like: key=/pattern/flags
function parseFilters(block) {
  const out = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim().toLowerCase();
    if (!["item", "title", "link", "desc"].includes(key)) continue;

    const regex = line.slice(eq + 1).trim();
    if (!regex.startsWith("/")) continue;

    const lastSlash = regex.lastIndexOf("/");
    if (lastSlash <= 0) continue;

    const pattern = regex.slice(1, lastSlash); // raw between slashes
    if (!pattern) continue; // empty pattern is like not set

    const flags = regex.slice(lastSlash + 1); // may be empty

    try {
      const pat = pattern.replace('\/', '/');
      out[key] = new RegExp(pat, flags);
    } catch {
      // ignore invalid regex
    }
  }

  return Object.keys(out).length ? out : undefined;
}

function matchFilters(item, filters, itemText) {
  if (!filters) return true;

  if (filters.item && !filters.item.test(itemText || "")) return false;
  if (filters.title && !filters.title.test(item.title || "")) return false;
  if (filters.link && !filters.link.test(item.link || "")) return false;
  return !(filters.desc && !filters.desc.test(item.desc || ""));
}

