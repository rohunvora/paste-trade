# Changelog

Versioning note:
- public release numbering starts at `1.x`
- the March 5 rewrite was previously tracked internally as `2.0.0`
- install commands use the bare repo path (no version tag)

## [1.2.1] - 2026-03-13

OpenClaw wrapper reliability and chat UX fixes.

### Fixed

- `openclaw-plugin/run-trade-wrapper-lib.mjs` — runs `/trade` in a fresh per-run session, sends the progress link directly after source creation, waits for real runtime evidence before marking the run complete, and forwards only the compact final summary back to chat
- `openclaw-plugin/run-trade-wrapper.mjs` — awaits the async wrapper exit path so the live-link watcher does not crash before sending the progress link
- `openclaw-plugin/trade-slash-dispatch-lib.mjs` — resolves installed-vs-dev skill layouts correctly and injects wrapper-specific system instructions so the worker stays silent until final summary
- `SKILL.md` — fixes public-repo path examples from `skill/scripts/...` to `scripts/...` and from `skill/references/...` to `references/...`

### Changed

- OpenClaw chat flow is now: immediate background acknowledgement -> progress link -> final summary
- OpenClaw wrapper runs no longer spill intermediate model chatter like routing or posting updates into the main chat
- OpenClaw install docs now reflect automatic gateway reload after wrapper setup

## [1.2.0] - 2026-03-11

Polymarket pipeline, dense/sparse reference docs, streaming progress, and bug fixes.

### Changed

- `create-source.ts` — resolves `"now"` sentinel to ISO datetime via `resolveNowSentinel`
- `diarize.ts` — adds `stream-log` progress events and run-id support
- `discover.ts` — adds `stream-log`, `--thesis-id` flag, result summary logging
- `extract.ts` — adds `stream-log` progress events during extraction
- `post.ts` — Polymarket handling (skip assess, normalize direction/instrument, probability pricing), HL ticker prefix stripping for deeplinks
- `route.ts` — imports `route-fields.ts` for typed response parsing, Polymarket types, flag parsing fix (named flags before positional args), `resolveNowSentinel`, `stream-log`
- `save.ts` — adds `instrument` field to selected expression
- `source-excerpt.ts` — adds run-id, thesis-id, and stream-log progress

### Added

- `scripts/stream-log.ts` — stderr + live event push (fire-and-forget progress narration)
- `shared/trade-pricing.ts` — `toFiniteNumber()`, `resolveNowSentinel()` utility functions
- `adapters/route-fields.ts` — typed response parsing for `/api/skill/route` output
- `references/dense.md` — LLM instructions for podcast/article extraction
- `references/sparse.md` — LLM instructions for tweet/user thesis handling
- `references/hl-universe.md` — Hyperliquid thematic universe reference
- `references/prediction-markets.md` — Polymarket evaluation and posting reference
- `references/index/` — dense-index.md, skill-ascii.md, skill-index.md, trade-index.md
- SKILL.md updated with Polymarket as supported venue, dense/sparse reference pointers, streaming progress

### Removed

- `scripts/assess.ts` — stale alias (use `route.ts`)
- `scripts/route-check.ts` — stale alias (use `route.ts`)
- `references/glossary.md` — removed from dev

## [1.1.0] - 2026-03-08

Full sync from canonical dev repo. Three days of improvements since launch.

### Changed

- Core loop restructured: new step 3 (Enrich) for metadata resolution, speaker identity, diarization
- Step 5 split into sub-steps: 5a Research, 5b Narrate, 5c Price and save
- Derivation now includes `explanation` (free-form prose) and `comparison` (candidate grid) alongside steps
- Explanation voice guidance: lead with sharp insight, hedge with data not qualifiers
- `route-check.ts` replaced by `route.ts` as primary routing adapter (route-check kept as alias)
- `entry_price` renamed to `publish_price` across all schemas
- `headline` renamed to `headline_quote` with frozen-at-extraction semantics
- Save/post validation errors now exit 0 with `{ok: false}` (parallel-safe, no sibling-call cancellation)
- Sequential post constraint removed — posts can run concurrently
- `batch-save.ts` promoted to preferred save method for multi-thesis sources
- Save --update merged into single call (who + route_evidence + derivation together)
- Route evidence cross-reference validation documented
- `route.ts` output envelope documented (tool/route/diagnostics wrapper)
- Reference file pointer added to SKILL.md header
- Events.md updated with actual event types (thesis_routing, thesis_routed, thesis_dropped, thought, trade_posted)

### Added

- `discover.ts` — instrument search across Hyperliquid + Polymarket via /api/skill/discover
- `route.ts` — backend-only route adapter replacing route-check.ts
- `runtime-paths.ts` — portable path resolution for dev/public repo parity
- `source-excerpt.ts` — retrieve source context around thesis quotes during routing
- `update-source.ts` — push enriched metadata to source page mid-run

### Removed

- Rollback Scope section (no longer in rollback mode)
- Account and Key Behavior section (handled automatically by ensure-key.ts)
- "Out of scope" items now all in scope (edit-mode, prediction-market routing)

## [1.0.0] - 2026-03-05

First public release contract. Renumbered from the internal prelaunch `2.0.0`
rewrite from `v2-lab`.

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

## [0.1.0] - 2026-03-03

### Added

- Public `/trade` runtime adapters required for extract -> route -> post -> finalize flow.
- OpenClaw slash wrapper plugin (`trade-slash-wrapper`) and setup script.
- Public install/update docs for OpenClaw, Claude Code, and Codex.
- Public governance docs: `SECURITY.md`, `CONTRIBUTING.md`.

### Excluded by design

- Web app, worker app, archived/internal references, local memory/data snapshots.
