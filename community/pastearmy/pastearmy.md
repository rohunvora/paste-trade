# pastearmy

Build pages, features, and visualizations for paste.trade — the platform that turns any source into tracked trades with real-time P&L.

**Use this skill when:** someone wants to create, modify, or extend paste.trade's frontend, work with its API, build community tools, create data visualizations, or add pages to the paste.trade ecosystem. Triggers on: "build a page for paste.trade", "add a feature to paste.trade", "create a visualization for paste.trade data", "paste.trade", "pastearmy", "/pastearmy".

---

## What is paste.trade?

paste.trade converts trading ideas from any source into documented trades with real-time P&L tracking.

**Flow:** User runs `/trade [URL or text]` → AI reads source (tweet, YouTube, PDF, thesis) → finds tradeable ideas → routes to Robinhood (stocks), Hyperliquid (perps), or Polymarket (prediction markets) → locks price, tracks P&L → publishes shareable trade card with reasoning audit trail.

**Key URLs:**
- Landing page: https://paste.trade (vanilla HTML, single file)
- App: https://app.paste.trade (React SPA, private repo)
- API: https://paste.trade/api/
- Community build example: https://github.com/babakarto/paste-trade-analytics

---

## Architecture Rules

1. **Vanilla HTML only** — no React, Vue, Svelte, or any framework. The landing page is a single ~2287-line HTML file. All new pages must match this approach.
2. **Inline CSS/JS** — no external bundles or build steps.
3. **Bun proxy server** — browser requests to paste.trade/api are blocked by CORS. Always use a local Bun proxy. See `references/api.md` for the proxy template.
4. **Single-column layout** — max-width 600–700px, centered.
5. **Auto-refresh** — data pages should refresh every 60 seconds.

---

## Design System (Quick Reference)

The full design system is in `references/design-system.md`. Read it before writing any CSS. Here's the minimum you must know:

- **Background:** `#f5f1eb` (warm beige) with SVG fractal noise at 0.03 opacity
- **Cards:** `#fefdfb`, 18px border-radius, specific 3-layer box-shadow
- **Text font:** Geist (sans-serif)
- **Data font:** Geist Mono for ALL numbers, tickers, handles, P&L — no exceptions
- **Colors:** green `#15803d` (LONG/profit), red `#b91c1c` (SHORT/loss), blue `#2e5cff` (Polymarket)
- **Animation easing:** `cubic-bezier(0.34, 1.56, 0.64, 1)` on everything (spring bounce)
- **Theme:** warm/light ONLY — never dark mode
- **Font numbers:** always `font-variant-numeric: tabular-nums`

---

## API (Quick Reference)

Full API reference is in `references/api.md`. Key points:

- Auth: `x-api-key` header (user provides their own key via env var)
- **6 working endpoints:**
  - `GET /api/feed` — live feed grouped by source, includes real-time `prices` object
  - `GET /api/trades?limit=500` — flat trade list with cursor pagination, filterable by ticker/direction/platform/author
  - `GET /api/search?q=QUERY` — full-text search (needs BOTH `x-api-key` AND `Authorization: Bearer` headers)
  - `GET /api/leaderboard?window=7d&sort=avg_pnl` — author rankings (windows: `24h`, `7d`, `30d`, `all`; sorts: `avg_pnl`, `total_pnl`, `win_rate`, `trade_count`)
  - `GET /api/stats` — platform totals (users, total_trades, profitable_trades)
  - `GET /api/avatars/:id` — author avatar images (JPEG)
- `GET /api/health` — no auth needed, returns `{ ok, service, ts }`
- CORS blocked — must proxy through Bun server
- `/api/search` response uses `trade_id` (not `id`) and has `chain_steps` + `explanation` at top level

---

## How to Build a New Page

1. Read `references/design-system.md` for exact CSS specs
2. Read `references/api.md` for endpoints and data shapes
3. Copy `assets/page-template.html` as your starting point
4. Copy `assets/proxy-server.ts` for local development
5. Create your page as a single vanilla HTML file
6. Add the route to the proxy server
7. Test with `bun run server.ts`

---

## How to Add Features to Existing Pages

1. Read the existing HTML file first
2. Match existing patterns (card style, animation timing, data flow)
3. Keep it vanilla JS
4. Read `references/design-system.md` to verify you're using exact specs

---

## Reference Files

| File | When to read |
|------|-------------|
| `references/design-system.md` | Before writing ANY CSS or HTML for paste.trade |
| `references/api.md` | When fetching data or building the proxy server |
| `references/architecture.md` | When planning a new page or understanding the existing community build |
| `assets/page-template.html` | Starting point for any new page |
| `assets/proxy-server.ts` | Starting point for local dev server |

---

## Gotchas

These are the most common mistakes. Avoid them:

1. **Using a framework** — paste.trade is vanilla HTML/CSS/JS. No React. No build step. Every time you reach for `import React`, stop.

2. **Wrong font on data** — ALL numbers, tickers, handles, percentages, dates MUST use Geist Mono. If it's data, it's mono. The most common mistake is using the sans-serif font for P&L numbers.

3. **Missing noise texture** — the background is NOT just `#f5f1eb`. It has an SVG fractal noise overlay at 0.03 opacity. Without it, pages look flat and wrong.

4. **Wrong card shadow** — the card shadow is a specific 3-layer shadow, not a generic `box-shadow: 0 2px 4px rgba(0,0,0,0.1)`. Read the exact spec in `references/design-system.md`.

5. **Missing spring bounce** — ALL animations must use `cubic-bezier(0.34, 1.56, 0.64, 1)`. Default `ease` or `ease-in-out` looks mechanical and wrong.

6. **Hardcoding API keys** — NEVER put API keys in HTML or commit them. Always read from environment variables via the proxy server.

7. **Forgetting CORS proxy** — direct browser fetch to paste.trade/api will fail. Always proxy through Bun server.

8. **Dark mode** — paste.trade is warm/light themed. Never add dark mode.

9. **Missing card rotation** — cards have slight "sticker" rotations (±0.2–0.4deg per card). Without these, the layout looks generic.

10. **Wrong direction badge colors** — LONG = green `#15803d`, SHORT = red `#b91c1c`, YES/NO = blue `#2e5cff` (Polymarket). Don't mix them up. Platform-specific colors: Robinhood green `#007a03`, Hyperliquid teal `#00b478`.

11. **Missing `tabular-nums`** — without `font-variant-numeric: tabular-nums`, P&L numbers jump around as they update. Always set it.

12. **Missing staggered animation** — card entries should stagger at 60ms intervals, not all appear at once.

13. **Skipping auto-refresh** — data pages need 60-second refresh cycles so trades stay live.

14. **Using wrong container width** — single column = 600px max, 2-column grid = 700px max. Don't use 1200px or full-width layouts.
