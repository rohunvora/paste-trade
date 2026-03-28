# paste.trade Design System — Complete Specification

## Philosophy

**"Premium paper-like trading journal"**
- Warm beige palette, never dark mode
- Card "sticker" feel with slight rotations and soft shadows
- Mono for ALL data (precision feel)
- Spring bounce animations (alive, not mechanical)
- Dense content, no wasted space

---

## Colors (CSS Variables)

```css
:root {
  /* Core palette */
  --ink: #1a1a1a;        /* Primary text, dark button backgrounds */
  --ink-2: #444444;      /* Secondary text */
  --ink-3: #736a61;      /* Tertiary text, muted brown */
  --ink-4: #6b6b6b;      /* Disabled text, placeholders */
  --paper: #f5f1eb;      /* Page background (warm beige) */
  --card: #fefdfb;       /* Card background (warm white) */
  --line: #e5e3dc;       /* Borders, dividers */
  --dash: #d4d0c8;       /* Hover borders */

  /* Semantic */
  --green: #15803d;      /* Profit, LONG, YES */
  --red: #b91c1c;        /* Loss, SHORT, NO */

  /* Platform-specific */
  --pm: #2e5cff;         /* Polymarket blue */
  --rh: #007a03;         /* Robinhood green */
  --hl: #00b478;         /* Hyperliquid teal */
}
```

---

## Background Texture

SVG fractal noise overlay at opacity 0.03 on top of `--paper`:

```css
body {
  background: var(--paper);
  margin: 0;
}

body::before {
  content: '';
  position: fixed;
  inset: 0;
  background: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 0;
}
```

---

## Fonts

```css
/* Sans-serif — body text */
font-family: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;

/* Monospace — ALL data, numbers, tickers, handles */
font-family: 'Geist Mono', 'SF Mono', 'Menlo', monospace;
```

Load from CDN:
```html
<link href="https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/style.min.css" rel="stylesheet" />
<link href="https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-mono/style.min.css" rel="stylesheet" />
```

Font smoothing:
```css
body {
  -webkit-font-smoothing: antialiased;
  font-synthesis: none;
}
```

---

## Typography Scale

| Element | Font | Size | Weight | Spacing |
|---------|------|------|--------|---------|
| Page title | Geist Mono | 18px | 800 | -0.02em |
| Card ticker | Geist Mono | 13px | 800 | -0.02em |
| Author handle | Geist Mono | 10-11px | 700 | — |
| Direction badge | Geist Mono | 8-10px | 700 | 0.04em |
| PNL numbers | Geist Mono | 10-13px | 800 | — |
| Body text | Geist | 12-13px | 400-500 | — |
| Labels | Geist Mono | 9px | 700 | 0.08em |
| Small data | Geist Mono | 7-9px | 600 | — |

ALL numbers use: `font-variant-numeric: tabular-nums;`

---

## Card Component

```css
.card {
  background: var(--card);       /* #fefdfb */
  border: none;
  border-radius: 18px;
  padding: 16px;                 /* mobile: 12px */
  box-shadow:
    0 1px 0 rgba(0,0,0,0.04),
    0 2px 8px rgba(0,0,0,0.06),
    0 6px 20px rgba(0,0,0,0.04);
}

/* Hover */
.card:hover {
  transform: translateY(-2px) rotate(0.3deg);
  box-shadow:
    0 2px 0 rgba(0,0,0,0.04),
    0 4px 12px rgba(0,0,0,0.08),
    0 12px 32px rgba(0,0,0,0.06);
}

/* Sticker rotation per card */
.card:nth-child(1) { transform: rotate(-0.3deg); }
.card:nth-child(2) { transform: rotate(0.2deg); }
.card:nth-child(3) { transform: rotate(-0.4deg); }
.card:nth-child(4) { transform: rotate(0.3deg); }
```

---

## Direction Badges

```css
.dir-badge {
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 3px 8px;
  border-radius: 999px;
  color: white;
  text-transform: uppercase;
}
.dir-long  { background: var(--green); box-shadow: 0 1px 2px rgba(21,128,61,0.25); }
.dir-short { background: var(--red);   box-shadow: 0 1px 2px rgba(185,28,28,0.25); }
.dir-yes   { background: var(--pm);    box-shadow: 0 1px 2px rgba(46,92,255,0.25); }
.dir-no    { background: var(--pm);    box-shadow: 0 1px 2px rgba(46,92,255,0.25); }
```

---

## Venue Pills

```css
.venue-pill {
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 5px 10px;
  border-radius: 999px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.venue-hl { border: 2px solid var(--hl); background: rgba(0,180,120,0.08); color: var(--hl); }
.venue-rh { border: 2px solid var(--rh); background: rgba(0,122,3,0.08);   color: var(--rh); }
.venue-pm { border: 2px solid var(--pm); background: rgba(46,92,255,0.08); color: var(--pm); }
```

---

## Pill Buttons (Nav, CTA)

```css
/* Nav brand */
.nav-brand {
  background: var(--card);
  border: 2px solid var(--line);
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 800;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

/* Tab switch */
.tab {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  border: none;
  background: transparent;
}
.tab-active   { color: var(--ink); background: var(--line); }
.tab-inactive { color: var(--ink-4); background: transparent; }
```

---

## Animations

ALL transitions use the spring easing:
```css
cubic-bezier(0.34, 1.56, 0.64, 1)
```

### Card Entry
```css
@keyframes pop {
  from { opacity: 0; transform: scale(0.7) translateY(6px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
animation: pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
```

### Staggered Entry (60ms per item)
```css
.item:nth-child(1) { animation-delay: 0.1s; }
.item:nth-child(2) { animation-delay: 0.16s; }
.item:nth-child(3) { animation-delay: 0.22s; }
.item:nth-child(4) { animation-delay: 0.28s; }
.item:nth-child(5) { animation-delay: 0.34s; }
```

### Live Dot Pulse
```css
@keyframes pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(21,128,61,0.4); }
  50%      { opacity: 0.7; box-shadow: 0 0 0 4px rgba(21,128,61,0); }
}
```

### Reveal / Expand (Dropdowns)
```css
/* Use grid-template-rows: 0fr → 1fr */
transition: grid-template-rows 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
```

### Hover
```css
transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
```

---

## Layout

- Container max-width: **600px** (single column) or **700px** (2-column grid)
- Padding: 16px mobile, 32px sections
- Gap: 8px primary, 10px between cards
- Spacing scale: 4, 8, 12, 16, 24, 32, 48px
- Always center the container: `margin: 0 auto`
