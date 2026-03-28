# paste.trade API Reference

## Authentication

```
Header: x-api-key: YOUR_PASTE_TRADE_KEY
```

Users must provide their own API key via environment variable `PASTE_TRADE_KEY`. Never hardcode keys.

---

## Endpoints Overview

| Endpoint | Purpose | Auth | Notes |
|----------|---------|------|-------|
| `GET /api/feed` | Live feed (grouped by source) | x-api-key | Returns sources with nested trades + live prices |
| `GET /api/trades` | Raw trade list | x-api-key | Cursor pagination, filtering by ticker/direction/platform/author |
| `GET /api/search?q=` | Full-text search | x-api-key + Bearer | Returns enriched trades with chain_steps, explanations |
| `GET /api/leaderboard` | Author rankings | x-api-key | Sortable, supports time windows |
| `GET /api/stats` | Platform totals | x-api-key | Users count, total trades, profitable count |
| `GET /api/sources?url=` | Lookup source by URL | x-api-key | Returns source + associated trades |
| `GET /api/avatars/:id` | Author avatar image | x-api-key | Returns JPEG image |
| `GET /api/health` | Health check | none | Returns `{ ok, service, ts }` |

---

## GET /api/feed

Returns trades grouped by source, with live prices. This is what powers the landing page.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 20 | Number of feed items (sources) to return |
| `cursor` | string | — | Pagination cursor (ISO date from `next_cursor`) |

**Response shape:**
```json
{
  "items": [
    {
      "source": {
        "id": "9a74c04e-f",
        "title": "Source title or null",
        "platform": "x" | "youtube" | "pdf" | "substack" | "direct" | null,
        "published_at": "ISO 8601" | null,
        "created_at": "ISO 8601",
        "summary": "AI-generated summary" | null,
        "source_images": null
      },
      "author": {
        "handle": "username",
        "avatar_url": "/api/avatars/id" | null,
        "platform": "x" | "youtube" | "pdf" | etc.
      },
      "trades": [
        {
          "id": "1ba1a43f-2",
          "ticker": "BRENTOIL",
          "direction": "long",
          "platform": "hyperliquid",
          "instrument": "perps" | "shares" | "polymarket" | null,
          "author_price": 105,
          "posted_price": 104.71,
          "created_at": "ISO 8601",
          "logo_url": "https://..." | null,
          "author_handle": "username",
          "thesis_card": "short thesis" | null,
          "headline_quote": "verbatim quote" | null,
          "feed_headline": "feed display text" | null,
          "ticker_context": "what the instrument is" | null,
          "chain_steps": ["step1", "step2", ...] | [],
          "market_question": "Polymarket question text" | null,
          "market_cap_fmt": "$1.4T" | null,
          "condition_id": "polymarket condition" | null,
          "market_slug": "polymarket-slug" | null,
          "outcome": "yes" | "no" | null
        }
      ],
      "tradeCount": 1,
      "submitter": {
        "handle": "username",
        "avatar_url": null
      }
    }
  ],
  "next_cursor": "2025-12-30T06:51:48.000Z",
  "total": 460,
  "prices": {
    "trade_id": {
      "price": 104.89,
      "timestamp": 1774114895003
    }
  }
}
```

**Key difference from /api/trades:** Feed items are grouped by source (one source can have multiple trades). The `prices` object provides real-time prices keyed by trade ID — use this to calculate live P&L:

```javascript
// Calculate live PnL from feed data
function calcPnl(trade, prices) {
  const livePrice = prices[trade.id]?.price;
  if (!livePrice || !trade.posted_price) return null;
  const diff = livePrice - trade.posted_price;
  const pnl = trade.direction === 'short' ? -diff : diff;
  return (pnl / trade.posted_price) * 100;
}
```

---

## GET /api/trades

Returns flat trade objects with full metadata. Best for analytics and data pages.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 20 | Max items per page (up to 500) |
| `cursor` | string | — | Pagination cursor from `next_cursor` |
| `ticker` | string | — | Filter by ticker symbol (e.g., `BTC`, `NVDA`) |
| `direction` | string | — | Filter: `long`, `short`, `yes`, `no` |
| `platform` | string | — | Filter: `robinhood`, `hyperliquid`, `polymarket` |
| `author` | string | — | Filter by author handle |
| `sort` | string | — | Sort field (e.g., `pnl_pct`) |

**Note:** Filters on `ticker`, `direction`, `platform`, `author` do NOT filter server-side in all cases — the `total` count may remain the same. Always client-side filter for accuracy.

**Response shape:**
```json
{
  "items": [ /* Trade objects */ ],
  "next_cursor": "2026-03-21T16:11:15.728Z|067732a9-d",
  "total": 888
}
```

**Cursor format:** The cursor is `ISO_DATE|TRADE_ID`. Pass it as-is to the next request.

### Complete Trade Object

All fields returned by `/api/trades`:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique trade ID (e.g., "1ba1a43f-2") |
| `thesis` | string | The tradeable idea in one sentence |
| `ticker` | string | Ticker symbol ("NVDA", "BTC", "BRENTOIL", etc.) |
| `direction` | string | "long", "short", "yes", "no" |
| `author_price` | number | Price when the author made the call |
| `posted_price` | number | Price when the /trade command was run |
| `author_handle` | string | Who made the original call (thesis creator) |
| `source_url` | string\|null | Original source URL (tweet, video, etc.) |
| `author_date` | string\|null | ISO 8601 — when the author originally said it |
| `trade_type` | string | "direct" (author named it) or "derived" (AI connected the dots) |
| `user_id` | string | Internal user ID of who ran /trade |
| `author_id` | string | Internal author ID |
| `source_id` | string | Links to `https://app.paste.trade/s/{source_id}` |
| `ticker_id` | string | Internal ticker ID |
| `author_price_captured_at` | string\|null | When author price was captured |
| `created_at` | string | ISO 8601 — when the trade was created |
| `instrument` | string\|null | "shares", "perps", "polymarket" |
| `platform` | string | "robinhood", "hyperliquid", "polymarket" |
| `headline_quote` | string\|null | Verbatim quote from source |
| `ticker_context` | string\|null | What the instrument is (for display) |
| `derivation` | object\|null | AI reasoning chain (only on enriched trades) |
| `derivation.explanation` | string | Why this trade was derived from the source |
| `derivation.segments` | array | Source quotes with speaker attribution |
| `derivation.steps` | array | Reasoning steps with optional links |
| `derivation.chain_steps_card` | array | Short display-ready steps for cards |
| `horizon` | string\|null | Trade time horizon ("near-term", "by June 2026") |
| `alt_venues` | string\|null | Alternative ways to express this trade |
| `hl_ticker` | string\|null | Hyperliquid-specific ticker (e.g., "vntl:DEFENSE") |
| `outcome` | string\|null | Polymarket outcome ("yes", "no") |
| `pm_side` | string\|null | Polymarket side taken |
| `pm_yes_no_price` | number\|null | Polymarket token price |
| `market_question` | string\|null | Full Polymarket question text |
| `condition_id` | string\|null | Polymarket condition hash |
| `market_slug` | string\|null | Polymarket market slug |
| `event_slug` | string\|null | Polymarket event slug |
| `end_date` | string\|null | Market end date |
| `card_headline` | string\|null | Short headline for card display |
| `thesis_card` | string\|null | Shortened thesis for card display |
| `chain_steps_card` | array\|null | Short reasoning steps for card display |
| `user_handle` | string | Display handle of who ran /trade |
| `user_avatar_url` | string\|null | Avatar URL of submitter |
| `author_avatar_url` | string\|null | Avatar URL of thesis author |
| `logo_url` | string\|null | Ticker logo URL (e.g., from elbstream) |
| `market_cap_fmt` | string\|null | Formatted market cap ("$1.4T") |

---

## GET /api/search?q=

Full-text search across trades. Returns enriched results with chain_steps and explanations.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | **Required.** Search query (ticker, author, thesis text) |

**Auth:** Requires BOTH headers:
```
x-api-key: YOUR_KEY
Authorization: Bearer YOUR_KEY
```

**Response shape:**
```json
{
  "trades": [
    {
      "trade_id": "338d7677-5",
      "thesis": "...",
      "ticker": "SP500",
      "direction": "long",
      "platform": "hyperliquid",
      "instrument": "perps",
      "author_handle": "Paul_Robert_",
      "author_avatar_url": "/api/avatars/...",
      "source_url": "https://...",
      "source_title": "...",
      "source_platform": "reddit",
      "author_price": 6547.95,
      "posted_price": 6547.95,
      "created_at": "ISO 8601",
      "author_date": "ISO 8601",
      "headline_quote": "...",
      "ticker_context": "...",
      "chain_steps": ["step1", "step2", "step3"],
      "explanation": "...",
      "market_question": null,
      "pnl_pct": null,
      "current_price": null
    }
  ],
  "total": 18,
  "next_cursor": null
}
```

**Key differences from /api/trades:**
- Uses `trade_id` instead of `id`
- Includes `source_title`, `source_platform` fields
- Includes `chain_steps` as top-level array (not nested in `derivation`)
- Includes `explanation` as top-level string
- Includes `pnl_pct` and `current_price` (may be null)
- Does NOT include `user_handle`, `user_id`, `trade_type`

---

## GET /api/leaderboard

Returns author rankings with performance stats.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `window` | string | `7d` | Time window: `24h`, `7d`, `30d`, `all` |
| `sort` | string | `avg_pnl` | Sort by: `avg_pnl`, `total_pnl`, `win_rate`, `trade_count` |

**Response shape:**
```json
{
  "authors": [
    {
      "rank": 1,
      "author": {
        "id": "75c23110-0",
        "handle": "CryptoMikli",
        "name": null,
        "avatar_url": "/api/avatars/75c23110-0",
        "platform": "x"
      },
      "stats": {
        "trade_count": 3,
        "avg_pnl": 11.65,
        "win_rate": 66.67,
        "best_pnl": 33.77,
        "best_ticker": "Iran x Israel/US conflict ends by May 15?",
        "total_pnl": 34.94
      }
    }
  ],
  "window": "7d",
  "sort": "avg_pnl",
  "computed_at": "2026-03-21T16:40:25.889Z"
}
```

**Author platforms observed:** "x", "youtube", "pdf", "substack", "podcast", "direct", "robinhood", "polymarket", "bloomberg", "reuters", "reddit", "twitter"

---

## GET /api/stats

Returns platform-wide totals. No parameters.

**Response:**
```json
{
  "users": 111,
  "total_trades": 888,
  "profitable_trades": 339
}
```

---

## GET /api/sources?url=

Looks up a source by its original URL.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `url` | string | **Required.** The original source URL to look up |

**Response:** Returns the source object with associated trades, or `{"error":{"code":"not_found","message":"Source not found"}}` if not found.

---

## GET /api/avatars/:id

Returns the author's avatar as a JPEG image.

**Example:** `GET /api/avatars/75c23110-0` → returns image/jpeg

Use in `<img>` tags: `<img src="/api/avatars/${author.id}" />`

---

## GET /api/health

Health check endpoint. No authentication required.

**Response:**
```json
{
  "ok": true,
  "service": "api",
  "ts": 1774114886583
}
```

---

## Endpoints That Do NOT Exist

These were tested and returned empty/404:
- `/api/` (root) — empty response
- `/api/docs` — empty response
- `/api/authors` — empty response
- `/api/profiles` — empty response
- `/api/tickers` — empty response
- `/api/pnl` — empty response
- `/api/ws` — empty response (WebSocket is at a different URL)

---

## CORS — Proxy Required

Browser requests to paste.trade/api are blocked by CORS. You MUST use a local proxy server.

See `assets/proxy-server.ts` for a ready-to-use Bun proxy. Run with `bun run server.ts`.

The proxy must forward both headers:
```typescript
headers: {
  "x-api-key": API_KEY,
  "Authorization": `Bearer ${API_KEY}`,
}
```

---

## Data Logic Patterns

Common calculations used across pages:

```javascript
// "X people /trade'd this" = count of unique user_handle values for a ticker
const tradersCount = new Set(
  trades.filter(t => t.ticker === ticker).map(t => t.user_handle)
).size;

// Dots per author = unique user_handle values for that author on that ticker
const dotsForAuthor = new Set(
  trades.filter(t => t.author_handle === author && t.ticker === ticker)
    .map(t => t.user_handle)
).size;

// Best trade = highest pnl_pct for an author
const bestTrade = trades
  .filter(t => t.author_handle === author)
  .sort((a, b) => b.pnl_pct - a.pnl_pct)[0];

// Calendar day color (by trade volume, not pnl):
//   1-4 trades:  light yellow
//   5-7:         medium yellow
//   8-10:        dark amber with glow
//   11-14:       orange with glow
//   15+:         fire red with glow

// Live PnL calculation (from feed prices)
function calcPnl(trade, prices) {
  const livePrice = prices[trade.id]?.price;
  if (!livePrice || !trade.posted_price) return null;
  const diff = livePrice - trade.posted_price;
  const pnl = trade.direction === 'short' ? -diff : diff;
  return (pnl / trade.posted_price) * 100;
}

// Win rate = trades where pnl_pct > 0 / total trades
// Avg PnL = sum of pnl_pct / trade_count
```

---

## Fetching Data in Pages

Always fetch from the local proxy, never directly from paste.trade:

```javascript
// Basic fetch
async function fetchTrades(limit = 500) {
  const resp = await fetch(`/api/trades?limit=${limit}`);
  const data = await resp.json();
  return data.items;
}

// With pagination (cursor-based)
async function fetchAllTrades() {
  let all = [];
  let cursor = null;
  do {
    const url = cursor
      ? `/api/trades?limit=500&cursor=${encodeURIComponent(cursor)}`
      : '/api/trades?limit=500';
    const resp = await fetch(url);
    const data = await resp.json();
    all = all.concat(data.items);
    cursor = data.next_cursor;
  } while (cursor);
  return all;
}

// Feed with live prices
async function fetchFeed(limit = 20) {
  const resp = await fetch(`/api/feed?limit=${limit}`);
  const data = await resp.json();
  return { items: data.items, prices: data.prices };
}

// Leaderboard
async function fetchLeaderboard(window = '7d', sort = 'avg_pnl') {
  const resp = await fetch(`/api/leaderboard?window=${window}&sort=${sort}`);
  return resp.json();
}

// Search
async function searchTrades(query) {
  const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  return resp.json();
}

// Stats
async function fetchStats() {
  const resp = await fetch('/api/stats');
  return resp.json();
}

// Auto-refresh every 60 seconds
setInterval(() => {
  fetchTrades().then(render);
}, 60000);
```
