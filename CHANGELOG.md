# Changelog

## [2.0.0] - 2026-03-05

Complete skill rewrite from v2-lab. Replaces v1 entirely.

### Changed

- Skill prompt rewritten with think-out-loud narration style
- Routing sequence is now: web research -> instrument discovery -> route-check -> save
- Web research is mandatory before picking instruments (training data is stale)
- Thesis scope determines routing: sector theses route to sector instruments, single stocks are proxies
- Diarization is now default-off, only triggered when attribution quality is insufficient
- Long transcript parallelization gated to word_count > 8,000 or chars > 45,000
- Headline target 120 chars, hard-fail at 180 chars
- `who` field now array-of-objects with 1-3 plausible instruments before route-check
- Reply format: Block 1 (why) + Block 2 (how to execute) with portfolio map for 3+ trades
- Post hydration derives missing fields from saved extraction, backfills via /api/skill/assess
- Chat UX has sequenced status messages: expectation -> duration -> live link -> summary
- Route evidence includes entry_price, source_date_price, since_published_move_pct

### Restructured

- Flat `scripts/` directory replaces nested `skill/adapters/` hierarchy
- `adapters/hyperliquid/` retained for instrument discovery only
- `references/` directory for supplementary docs
- Removed yahoo-finance2 dependency (market data served via paste.trade API)

### Out of scope (rollback profile)

- Edit-mode maintenance flows
- X profile scan workflows
- Prediction-market routing adapters

## [1.0.0] - 2026-03-03

### Added

- Public `/trade` runtime adapters required for extract -> route -> post -> finalize flow.
- OpenClaw slash wrapper plugin (`trade-slash-wrapper`) and setup script.
- Public install/update docs for OpenClaw, Claude Code, and Codex.
- Public governance docs: `SECURITY.md`, `CONTRIBUTING.md`.

### Excluded by design

- Web app, worker app, archived/internal references, local memory/data snapshots.
