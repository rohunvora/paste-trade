# paste.trade Architecture & Community Build Reference

## Landing Page Architecture

The paste.trade landing page is a single vanilla HTML file (~2287 lines). NOT React.

### Structure (top to bottom):
1. **Toast container** — fixed top, WebSocket-driven, shows live trades
2. **Navbar** — brand pill + GitHub stars + launch button
3. **Hero** — headline + `/trade` command demo
4. **Carousel** — 3 example trade cards, horizontal scroll with swipe on mobile
5. **Install CTA** — shimmer button
6. **Leaderboard** — tabs: top/recent
7. **Changelog** — collapsible
8. **Footer**

### Key features:
- WebSocket connection for live trade toasts and leaderboard updates
- Carousel with swipe on mobile
- PNL odometer animation (numbers count up with overshoot)
- All inline CSS/JS, no external bundles
- Fetches from `/api/feed`, `/api/leaderboard`

---

## Existing Community Build

GitHub: https://github.com/babakarto/paste-trade-analytics

### Pages Built:

#### Cluster Map (`cluster-map.html`)
- Groups trades by ticker
- Shows which authors called each ticker, with direction + pnl
- Dots per author = how many unique users /trade'd that author's thesis
- Glowing SVG nodes (3-layer: outer glow, mid ring, core with white highlight)
- Glow intensity scales with volume
- Source type filters: ALL, X (tweets), YouTube, PDF
- Filter animations: cards exit with fade+shrink, new cards enter with spring bounce + stagger
- Top 4 cards in 2×2 grid: top 2 by volume + top 1 most-shorted + top 1 polymarket
- Auto-refresh every 60 seconds
- Expandable author rows: click to see thesis text + "see full trade →" link

#### Author List (`author-list.html`)
- All authors sorted by trade count or best single trade
- Search bar with real-time filtering
- Each row: handle, trade count, best trade (ticker + direction + pnl%)
- Clickable → navigates to author profile

#### Author Profile (`author-profile.html`)
- Stats: trade count + best trade
- Best trade highlight card (green border)
- Monthly PnL calendar: day cells colored by trade volume (yellow→amber→orange→fire red)
- Month navigation with slide animations
- Cumulative P&L line chart (SVG)
- Full trade history with expandable thesis dropdowns
- Auto-refresh every 60 seconds

#### Server (`server.ts`)
- Bun proxy server
- Routes: `/` (cluster map), `/authors` (list), `/author/:handle` (profile)
- Proxies `/api/*` to paste.trade with API key

---

## Page Ideas for Contributors

These are examples of pages the community could build:

- **Ticker Deep Dive** — everything about a single ticker: all authors who called it, direction distribution, cumulative P&L chart, thesis timeline
- **Source Explorer** — browse trades by source type (X, YouTube, PDF, Substack), compare which source types produce best trades
- **P&L Heatmap** — calendar-style heatmap of all trades across the platform, colored by aggregate daily P&L
- **Author vs Author** — compare two authors side by side: trade count, win rate, best/worst trades, overlapping tickers
- **Live Feed Wall** — full-screen display of trades appearing in real-time via WebSocket, designed for display on monitors
- **Platform Breakdown** — Robinhood vs Hyperliquid vs Polymarket: which platform has best P&L, most trades, most unique tickers
- **Thesis Gallery** — browse the best thesis narratives, sorted by P&L outcome, with source links and full reasoning

---

## Contribution Workflow

### For new pages:
1. Create a vanilla HTML file (no framework — matches the landing page)
2. Use the exact design system (read `design-system.md`)
3. Fetch data from /api/ endpoints through the proxy server
4. Add the route to server.ts
5. Test locally with `bun run server.ts`

### For features on existing pages:
1. Read the existing HTML file first
2. Match the existing patterns (card style, animation timing, data flow)
3. Keep it vanilla JS — no React, no build step

### What NOT to do:
- Don't use React, Vue, or any framework
- Don't change the color palette or fonts
- Don't hardcode API keys — always read from env
- Don't skip animations — the UI should feel alive
- Don't use dark mode — paste.trade is warm/light themed
- Don't use generic shadows or border-radius — use the exact specs
- Don't forget the noise texture on the background
