# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Public `/trade` skill runtime for [paste.trade](https://paste.trade). It finds every tradeable thesis in a source (tweets, podcasts, articles, screenshots, hunches) and routes each to an executable trade on Hyperliquid, Robinhood, or Polymarket.

This repo contains **only** the skill runtime and install-critical assets. The paste.trade web/worker apps live elsewhere.

## Runtime

- **Bun** is the runtime. All scripts run via `bun run scripts/<name>.ts`.
- **No build step, no test suite, no linter.** This is a skill definition repo, not an application.
- External deps: `yt-dlp` (YouTube extraction), optional `GEMINI_API_KEY` (diarization), optional `X_BEARER_TOKEN` (Twitter API).

## Architecture

The skill is an LLM-driven pipeline defined in `SKILL.md` (the canonical behavior spec). The pipeline:

```
Extract source → Create source page → Enrich metadata → Extract theses → Research + Route → Narrate → Price → Post → Finalize
```

### Key files

- **`SKILL.md`** — The skill prompt. Defines the entire `/trade` pipeline: classify, extract, enrich, thesis extraction, research, routing, narration, pricing, posting, finalization. This is the source of truth; `AGENTS.md` defers to it.
- **`types.ts`** — Core TypeScript types (`Platform`, `TradeExpression`, `ParsedThesis`, `TrackedTrade`).
- **`scripts/`** — CLI tools the skill agent calls. Each script is a standalone Bun entrypoint that talks to the paste.trade API:
  - `extract.ts` — Pull text/transcript from URLs
  - `create-source.ts` — Create a live source page
  - `update-source.ts` — Push enriched metadata
  - `discover.ts` — Search instruments across venues (HL + Polymarket)
  - `route.ts` — Validate tickers, get pricing, select best expression
  - `save.ts` / `batch-save.ts` — Persist theses (with `--update` for routing results)
  - `post.ts` — Publish trades
  - `finalize-source.ts` — Close out a source run
  - `source-excerpt.ts` — Retrieve context from original source
  - `stream-thought.ts` / `status.ts` — Emit progress events to live page
  - `ensure-key.ts` — Auto-provisions `PASTE_TRADE_KEY` on first use
  - `common.ts` — Shared auth/HTTP helpers
  - `runtime-paths.ts` — .env resolution, data directory paths
- **`adapters/`** — Market API adapters. `route-fields.ts` has shared coercion utilities for route responses. `hyperliquid/` contains HL-specific adapter logic.
- **`shared/trade-pricing.ts`** — Price canonicalization (`publish_price` vs `source_date_price` vs `created_at_price`), `"now"` sentinel resolution.
- **`references/`** — Supplementary docs loaded by SKILL.md at runtime (dense/sparse extraction rules, HL universe, prediction markets, routing decisions, event types).
- **`openclaw-plugin/`** — OpenClaw-only async command bridge. Runs `/trade` in a fresh background session, sends the progress link from the wrapper, and keeps worker chatter out of the main chat.

### Data flow

Scripts communicate with the paste.trade API (default `https://paste.trade`). Auth is via `PASTE_TRADE_KEY` in `.env`, auto-provisioned if missing. A `run_id` threads through all API calls in a single `/trade` invocation. Scripts read JSON from stdin or CLI args and write JSON to stdout.

### Streaming lifecycle

Every tool call emits WebSocket events to the source page. Thesis state machine: `saved → routing → routed | dropped → posted`. Event types include `started`, `extracted`, `enriching`, `source_updated`, `thesis_saved`, `thesis_routing`, `thesis_routed`, `thesis_dropped`, `trade_posted`, `done`, `error`.

## Conventions

- All scripts use Bun APIs (`Bun.stdin`, `import.meta.dir`).
- Scripts exit 0 even on validation errors (returning `{"ok": false, "error": "..."}`) so parallel calls don't cancel siblings.
- `source_date` uses ISO 8601 with time component. Date-only resolves to midnight UTC which gives wrong prices. Use `"now"` for user-typed theses (scripts resolve to actual current time).
- Instrument preference order: Hyperliquid perps > Polymarket prediction markets > Robinhood shares.
- `headline_quote` is frozen at extraction time and must exactly match a `quotes[]` entry.
- `routed_ticker` from route output maps to `ticker` in post payload.
- No em dashes in any output text.

## Temporary work

Use `.scratch/` for all temporary artifacts. It's gitignored. Never commit files from it. See `TEMPORARY_WORK_POLICY.md`.

## Install contract

Paste the repo URL into your agent:

```
https://github.com/rohunvora/paste-trade-skill
```

Supported clients: OpenClaw, Claude Code, Codex. OpenClaw additionally requires running the wrapper setup script after install. If install/update commands change, update `README.md` and all three `docs/install/*.md` files.
