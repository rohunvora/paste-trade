# paste.trade/skill

Can an AI read what someone said about markets and turn it into a tracked, auditable trade?

This repo is the reasoning engine. [paste.trade](https://paste.trade) is where the results live.

## The experiment

Someone says something about markets — a tweet, a podcast clip, an article, a hunch typed into a terminal. An AI agent reads it, extracts every tradeable thesis, researches instruments, picks the best expression for each, explains its reasoning, and locks the price.

Then we wait. Live P&L tracks from that moment forward. Was the AI's interpretation right? Did it pick a better instrument than the author implied? You can check — every trade is public, every reasoning step is visible, every price is locked.

We're running this experiment in public.

## What happens when you paste a URL

You paste a tweet. The agent reads it. Finds the tradeable ideas. Researches instruments — stocks, perps, prediction markets. Compares candidates side by side. Picks the best fit. Explains why.

Locks two prices:
- when the author said it
- when the AI posted the trade

You watch it resolve live on the source page. Then we track P&L from that moment forward. No backtesting. No hypotheticals. Just: was the AI right?

## What this is not

Not a trading bot. It doesn't execute. Not a black box. Every reasoning step is visible. Not financial advice. It's an experiment.

It's an AI that shows its work and gets graded.

## This repo vs paste.trade

| this repo | paste.trade |
|---|---|
| the reasoning engine | the accountability layer |
| reads sources | tracks P&L |
| extracts theses | hosts source pages |
| researches tickers | streams progress live |
| explains reasoning | publishes share cards |
| posts trades | ranks authors by results |
| **runs in your agent** | **anyone can verify** |

## Install

Paste into Claude Code, Codex, or OpenClaw:

```
https://github.com/rohunvora/paste-trade-skill
```

Then:

```
/trade https://x.com/someone/status/123456789
/trade update
```

## Works with

Tweets, YouTube, podcasts, articles, PDFs, screenshots, typed hunches.

Routes to: Robinhood (stocks), Hyperliquid (perps), Polymarket (prediction markets).

## Prerequisites

- [Bun](https://bun.sh) runtime
- `yt-dlp` for YouTube extraction — the skill will offer to install it on first run
- See [env.example](env.example) for environment variables

## See it working

- Live feed: [paste.trade](https://paste.trade)
- How it works: [ARCHITECTURE.md](ARCHITECTURE.md)
- Changelog: [paste.trade/#changelog](https://paste.trade/#changelog)

The results are public. Go look.
