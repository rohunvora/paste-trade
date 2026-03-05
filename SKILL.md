---
name: trade
description: Finds every tradeable thesis in a source and routes each to an executable trade. Works with tweets, podcasts, articles, screenshots, hunches, and market observations. Use when the user says "/trade", "trade this", "what's the trade", pastes a source and wants the trade, or states a directional belief they want translated into an expression. Stay dormant for generic market chat.
metadata:
  openclaw:
    homepage: https://github.com/rohunvora/paste-trade-skill/blob/main/docs/install/openclaw.md
    requires:
      bins:
        - bun
command-dispatch: tool
command-tool: trade_slash_dispatch
---

# /trade

Think through trades live. The user is watching the work, not just the final card. Narrate what changed your mind, what has no clean expression, and why one instrument beats another.

## Defaults

- $100K risk capital, max upside
- Robinhood + Hyperliquid first
- Best single trade per thesis
- No em dashes in output
- End every response with: `Expressions, not advice. Do your own research.`

## Chat UX

- Keep chat updates operational and brief.
- First status line should set expectation: `Running /trade now. I will send a live link shortly.`
- For transcript sources, next status line should set duration expectation: `On it. Pulling transcript now. Longer videos can take a few minutes.`
- After source creation, send: `Watch live: {source_url} (I will post final trades here when done).`
- Keep final Telegram chat copy concise when a paste.trade link exists: summary + execution blocks, then link.

## Rollback Scope

This rollback profile intentionally keeps only the proven core flow:

- thesis extraction
- source creation + live stream events
- route-check based routing (Hyperliquid/Robinhood)
- post + finalize accounting

Temporarily out of scope in this profile:

- edit-mode maintenance flows
- X profile scan workflows
- prediction-market routing adapters

## Core Loop

### 1. Classify input

- URL source: extract first.
- User-typed thesis: their words are the thesis. Skip extraction.
- If URL is `paste.trade/s/:id` or `paste.trade/t/:id`, treat as normal source input in this rollback profile.

Source-link speed rule (mandatory):

- Create the source page immediately after the first successful metadata extraction, before any long-running transcript or diarization work.
- Do not wait for diarization to finish before creating the source URL.
- If some metadata is missing, create with best-known fields now and continue processing.

Primary extraction:

```bash
bun run scripts/extract.ts "URL"
# Returns: { source, word_count, saved_to, title?, published_at?, channel_handle?, description?, duration_seconds? }
# YouTube: transcript omitted from output; read the file at saved_to.
```

Execution sequence (mandatory):

1. Run `extract.ts`.
2. Immediately run `create-source.ts` and send the live board URL.
3. Only after source creation, run optional long steps (`diarize.ts`, transcript reads, uploads).

### 2. Create the source run

Create the source page as soon as you know the source metadata:

```bash
bun run scripts/create-source.ts '{ "url": "...", "title": "...", "platform": "...", "author_handle": "...", "source_date": "...", "source_images": [...], "word_count": N, "duration_seconds": N, "speakers_count": N }'
# Returns: { source_id, source_url, status: "processing", run_id }
```

Notes:

- `author_handle` here means the source publisher/channel handle.
- YouTube uses `channel_handle`, not a guest speaker.
- `word_count`, `duration_seconds`, `speakers_count` are optional extraction metadata for the live stats bar.
- Save `run_id` and thread it through every later adapter call for this source run.
- If the prompt includes internal tracing metadata (`run_id=...`), pass that value as `run_id` in the `create-source.ts` payload.
- Use the canonical live-link line from Chat UX.
- For YouTube/no-captions flows, this step must happen before `diarize.ts` and before long transcript reads.

Status update payload shape:

```bash
bun run scripts/status.ts <source_id> '{ "event_type": "status", "data": { "message": "..." } }'
```

Tell the user: `Watch live: {source_url}`

YouTube diarization gate (after source exists, optional):

- Do not run `diarize.ts` by default.
- Run `diarize.ts` only when attribution quality is insufficient for quote ownership:
  - multiple speakers are present and identity is ambiguous in extract output
  - planned theses depend on who said the quote
  - extract transcript lacks reliable speaker labels/timestamps for the needed quotes
- Skip diarization when single-speaker attribution is already clear enough for save/post/finalize.
- If diarization is needed, start it after source creation as non-blocking enrichment; never block save/update/post/finalize waiting for it.

```bash
bun run scripts/diarize.ts "URL"
# Speaker labels + timestamps. Costs ~$0.14/hr. Writes to its own saved_to.
```

Canonical transcript:

- default: use extract `saved_to`
- if diarization completes in time and improves attribution, switch to diarize `saved_to`
- always read from the file path, not task output
- upload full text once per run:

```bash
bun run scripts/upload-source-text.ts <source_id> --file <saved_to> --provider transcript
```

### 3. Extract theses

Read the canonical source artifact and find every tradeable thesis.

A thesis is a directional belief about what changes and what that means for price.

Process:

1. First pass: list candidate theses chronologically, one line each, with the quote that most implies direction.
2. Second pass: save every real candidate as an initial unrouted thesis record before routing.
3. Third pass: run route-check, then update each thesis to routed or confirmed unrouted.

```json
{
  "thesis": "short description of the directional belief",
  "horizon": "author's timing language, if any",
  "route_status": "unrouted",
  "unrouted_reason": "pending_route_check",
  "who": [
    { "ticker": "instrument that expresses this thesis", "direction": "long | short" }
  ],
  "why": ["reasoning step from author", { "text": "researched fact", "url": "...", "origin": "research" }],
  "quotes": ["verbatim quote from source, never rephrase"],
  "headline": "exact quote from quotes[] that is <=120 chars",
  "source_date": "ISO 8601 datetime when available (published_at), date-only fallback otherwise"
}
```

`who` should contain 1-3 plausible instruments per thesis before route-check.

For unresolved candidates, do not drop them. Save them as:

```json
{
  "thesis": "directional belief still worth tracking",
  "route_status": "unrouted",
  "unrouted_reason": "no clean liquid instrument / weak directional expression / evidence gap",
  "who": [],
  "why": ["why this still matters"],
  "quotes": ["supporting quote"],
  "headline": "best directional quote"
}
```

Narrate the thesis map to the live page after the first pass:

```bash
bun run scripts/stream-thought.ts --run-id <run_id> "Found 4 theses: oil supply risk, gold safe haven, defense spending will go up, Anthropic will win"
```

Save each thesis:

```bash
bun run scripts/save.ts --run-id <run_id> '<thesis JSON>'
# Returns: { id, file, count }
cat thesis.json | bun run scripts/save.ts --run-id <run_id> --stdin

bun run scripts/save.ts --run-id <run_id> --update <id> '<partial JSON>'
```

Each thesis routes independently.
Save and post steps should be sequential to avoid sibling-call cancellation on first failure.
Do not use routing difficulty as a filter at extraction time. Capture first, then route or explicitly mark unrouted.

Long transcript handling:

- If transcript is chunked into 3+ parts (or word_count > 8,000), split extraction pass by chunk.
- Only parallelize chunk extraction when transcript size is clearly large (`word_count > 8,000` or transcript chars > 45,000).
- If below that threshold, do chunk extraction sequentially in the main thread.
- If you parallelize, workers are extraction-only: main thread must merge/dedupe, then do all save/update/post/finalize calls.

### 4. Route the thesis

For each thesis, find the best trade.

For each thesis, determine the best executable expression on supported venues.
On adapter error in this stage, use Continuous Recovery Loop and retry the same step.

Routing sequence per thesis: research -> discover -> route-check -> save.

Supported venues:

- Hyperliquid
- Robinhood
- Polymarket

Available routing tools (use in this order):

- Web research: Run at least one search per thesis before picking instruments.
  Your training data is stale - verify the thesis still holds at current date,
  check for recent catalysts, and find facts the source doesn't mention. Cite
  in `why` as { "text": "...", "url": "...", "origin": "research" } and persist
  to `research_used`. A trade with current-date research is a better output
  than one without it.

- Instrument discovery (`adapters/hyperliquid/instruments.ts --query "<thesis keywords>" --compact`):
  Searches the live Hyperliquid universe - including sector baskets, commodities,
  indices, private company perps, and equities you may not know exist. Returns
  ranked candidates with descriptions.

- `route-check` (`scripts/route-check.ts`): Validates a specific ticker/date against supported venues and returns pricing context. Does not
  generate candidates - only validates them.

- `save.ts --update`: Persist the routed or unrouted outcome and its route evidence.

Routing requirements:

- If a thesis is executable on both Hyperliquid and Robinhood, prefer Hyperliquid.
- If best trade is not one of the initially considered direct tickers, update
  thesis with explicit proxy reasoning and citations.
- Before final route, check quote-to-trade logic: if original author would not
  recognize the link, reroute.

Thesis scope determines routing order:

  A thesis about a *specific company* ("NuScale can't deliver") -> route-check
  the company ticker directly.

  A thesis about a *sector, commodity, index, or industry trend* ("nuclear
  industry shakeout", "lithium prices surging", "data center energy demand") ->
  the direct expression is a sector/commodity instrument, not a single equity.
  A single stock is a proxy for a sector thesis. Run instrument discovery first,
  then route-check the best candidate. Only fall back to a single equity if no
  sector-level instrument exists or has insufficient liquidity.

Directness classification:

- `direct`: original author would recognize this as their trade.
- `derived`: author did not name it, but market link is immediate and defensible.

For routed theses, update saved records to include canonical route evidence:

```json
{
  "route_status": "routed",
  "who": [{ "ticker": "SMR", "direction": "short" }],
  "route_evidence": {
    "subjects": [{ "label": "NuScale Power", "subject_kind": "company" }],
    "direct_checks": [
      {
        "subject_label": "NuScale Power",
        "ticker_tested": "SMR",
        "executable": true,
        "shares_available": true,
        "entry_price": 12.54,
        "source_date_price": 12.525
      }
    ],
    "selected_expression": {
      "ticker": "SMR",
      "direction": "short",
      "instrument": "shares",
      "platform": "robinhood",
      "trade_type": "direct",
      "entry_price": 12.54,
      "source_date_price": 12.525,
      "since_published_move_pct": 0.12
    }
  }
}
```

Mapping rule from route-check output:

- `route.selected_expression.routed_ticker` -> `route_evidence.selected_expression.ticker`
- keep `instrument`/`platform` strings exactly as returned (`shares`/`perps`, `robinhood`/`hyperliquid`)
- if proxy route selected, include `fallback_reason_tag` (and `fallback_reason_text` when direct executable exists)

Build a derivation chain for every routed trade:

```json
{
  "segments": [
    { "quote": "verbatim source quote", "speaker": "who", "speaker_handle": "x_handle", "timestamp": "14:22", "source_url": "..." }
  ],
  "steps": [
    { "text": "reasoning grounded in source", "segment": 0 },
    { "text": "researched fact backing the thesis", "url": "https://..." },
    { "text": "inference: skill's own reasoning" }
  ]
}
```

Rules:

- `segment` index = grounded in a source quote
- when a step depends on external research or a factual check, embed the source inline as `[phrase](url)`; treat this as part of the format, not decoration
- `url` on a step is a fallback when inline linking does not fit
- 2-5 steps
- be honest when a step is your own inference
- user thesis: their words are the segment, `speaker: "user"`
- video/podcast: include timestamps; resolve speaker X handles when it materially helps attribution

### 5. Choose the instrument and price it

Instrument preference:

- Direct thesis subject on Hyperliquid -> perps
- Otherwise direct thesis subject via shares
- If no direct executable route, use the best proxy

Pricing:

```bash
bun run scripts/route-check.ts --run-id <run_id> TICKER direction --source-date "ISO-8601-datetime-or-YYYY-MM-DD" --horizon "timing"
# Returns selected expression + price context.
# If perps route selected and routed_ticker is provided, post that routed_ticker as ticker.
```

Use tool numbers directly. Do not estimate or recompute.

Update the thesis record with pricing and routing details:

```bash
bun run scripts/save.ts --run-id <run_id> --update <id> '<partial JSON>'
```

### 6. Post and finalize

Post each trade:

```bash
echo '<JSON payload>' | bun run scripts/post.ts --run-id <run_id>
```

Post rules:

- Post routed theses sequentially.
- `headline_quote` must be an exact string match to one of saved `quotes[]`.
- Keep `headline_quote` <=120 chars (choose this during extraction; do not paraphrase at post time).
- Posted `ticker`, `direction`, `instrument`, `platform`, and `trade_type` must match `route_evidence.selected_expression`.
- Always pass `source_date` as full ISO datetime when available (not date-only if timestamp exists).
- Carry `source_date_price` and `since_published_move_pct` from route-check `price_context` whenever present.
- `post.ts` will attempt baseline backfill via `/api/skill/assess` if those fields are missing, but treat that as fallback not primary path.

After all trade POSTs succeed, finalize the source explicitly:

```bash
echo '{ "source_id": "...", "source_theses": [...], "source_summary": "...", "message": "All trades posted" }' | bun run scripts/finalize-source.ts --run-id <run_id>
```

Finalization payload:

- `source_id`: source page being completed
- `source_theses`: all extracted theses, routed and unrouted
- each `source_theses` entry must carry `thesis_id` (or `id`) from `save.ts`
- each routed `source_theses` entry must include non-empty `who`
- each unrouted `source_theses` entry must include non-empty `unrouted_reason`
- every extracted thesis must appear exactly once in `source_theses` (no drops, no duplicates)
- `source_summary`: one-line summary of the whole source, especially important for grouped sources like timelines
- `message`: optional completion message

Do not rely on a trade POST to resolve the live source page.

## Output Contract

Required trade fields:

| Field | Notes |
|-------|-------|
| `ticker` | If route-check selected expression returns `routed_ticker`, use that ticker |
| `direction` | `"long"` or `"short"` |
| `entry_price` | Stocks/perps: `source_date_price` from route-check price context |
| `source_date_price` | Required for baseline P&L. Use route-check `price_context.source_date_price` |
| `since_published_move_pct` | Required when available. Use route-check `price_context.since_published_move_pct` |
| `thesis` | Thesis text |
| `headline_quote` | Must exactly match one saved `quotes[]` value and be <=120 chars |
| `ticker_context` | 1-3 sentences on what the ticker is, why it fits, and the recent catalyst. Inline-link external facts when they matter. |
| `author_handle` | Speaker/author whose quote anchors this trade; user thesis -> current authenticated user handle |
| `author_platform` | `"youtube"`, `"x"`, `"substack"`, `"podcast"`, `"pdf"`, `"direct"`, etc. |
| `source_url` | string or null |
| `source_date` | ISO 8601 |
| `trade_type` | `"direct"` or `"derived"` |
| `instrument` | `"shares"` or `"perps"` |
| `platform` | `"robinhood"` or `"hyperliquid"` |
| `thesis_id` | ID from `save.ts` |
| `derivation` | `{ segments, steps }` |

Top-level source fields:

- `source_title`: title/headline when the source has one
- `source_images`: image URLs extracted from the source

Finalization-only fields:

- `source_theses`: all theses from this source, passed to `finalize-source.ts`
- `source_summary`: one-line source summary, passed to `finalize-source.ts`

Useful optional `trade_data` fields:

- `source_date_price`
- `since_published_move_pct`
- `since_published_pnl_dollars`
- `horizon`
- `kills`
- `alt_venues`
- `avatar_url`

Important:

- Card price is the underlying asset price at `source_date`
- API warnings are real feedback; notice them and fix obvious quality problems before moving on
- Keep `run_id` explicit throughout the run. Do not rely on implicit context lookup.

## Reply Format

When done, reply in two blocks.

Block 1: why the trade makes sense

- author's words -> thesis -> instrument
- no execution numbers
- tweet: 2-3 sentences
- longer source: up to 2 short paragraphs

Block 2: how to execute

```text
TICKER · instrument · platform
$entry per contract · max loss $amount
Since source_date: +/-X% (interpretation)
Exit if: condition
```

When 3+ trades come from one source, open with 1-2 sentences framing the portfolio logic, then map them:

```text
[N] trades from @[handle]'s [source type]:

"headline quote" -> TICKER direction
"headline quote" -> TICKER direction
...

-> [source_url]
```

If both direct and derived trades exist, show direct first.

If posting fails: `Board unavailable. Skipping post.`

## Account and Key Behavior

- Preferred path: reuse one `PASTE_TRADE_KEY` across clients.
- First `/trade` run auto-creates key if none exists.
- If separate keys already exist, run account connect flow:

```bash
bun run scripts/connect.ts
```

## Hard Rules

1. Use "trades" and "market data", never "recommendations" or "advice"
2. Every number must come from a tool
3. Bear theses -> short-side instruments
4. Flag illiquid contracts
