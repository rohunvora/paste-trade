---
name: trade
description: Finds every tradeable thesis in a source and routes each to an executable trade. Works with tweets, podcasts, articles, screenshots, hunches, and market observations. Use when the user says "/trade", "trade this", "what's the trade", pastes a source and wants the trade, or states a directional belief they want translated into an expression. Stay dormant for generic market chat.
metadata:
  openclaw:
    homepage: https://paste.trade/docs/openclaw
    requires:
      bins:
        - bun
command-dispatch: tool
command-tool: trade_slash_dispatch
---

# /trade

Think through trades live. The user is watching the work, not just the final card. Narrate what changed your mind, what has no clean expression, and why one instrument beats another.

Supporting docs: `references/` (CLI cheatsheet, routing decision rules, event types, glossary).

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

## Core Loop

### 1. Classify input

- URL source: extract first.
- User-typed thesis: their words are the thesis. Skip extraction.
- If URL is `paste.trade/s/:id` or `paste.trade/t/:id`, treat as normal source input.

### 2. Extract and create source

Primary extraction:

```bash
bun run scripts/extract.ts "URL"
# Returns: { source, word_count, saved_to, title?, published_at?, channel_handle?, description?, duration_seconds? }
# YouTube: transcript omitted from output; read the file at saved_to.
```

Create the source page as soon as you know the source metadata:

```bash
bun run scripts/create-source.ts '{ "url": "...", "title": "...", "platform": "...", "author_handle": "...", "source_date": "...", "source_images": [...], "word_count": N, "duration_seconds": N, "speakers_count": N }'
# Returns: { source_id, source_url, status: "processing", run_id }
```

Execution sequence (mandatory):

1. Run `extract.ts`.
2. Immediately run `create-source.ts` and send the live board URL.
3. Do NOT read the `saved_to` file before this point.
4. Only after source creation, run enrichment, transcript reads, and uploads.

Notes:

- `author_handle` here means the source publisher/channel handle.
- YouTube uses `channel_handle`, not a guest speaker.
- `word_count`, `duration_seconds`, `speakers_count` are optional extraction metadata for the live stats bar.
- Save `run_id` and thread it through every later adapter call for this source run.
- If the prompt includes internal tracing metadata (`run_id=...`), pass that value as `run_id` in the `create-source.ts` payload.
- Use the canonical live-link line from Chat UX.

Status update payload shape:

```bash
bun run scripts/status.ts <source_id> '{ "event_type": "status", "data": { "message": "..." } }'
```

Tell the user: `Watch live: {source_url}`

### 3. Enrich source

Runs after the source page exists and the user has a live link. Runs before thesis extraction.

**Missing metadata resolution:**

- Check extraction output for missing `author_handle`, `source_date`, `title`.
- If author missing: scan extracted text for byline patterns, then web search URL/title to find author and X handle.
- If `source_date` missing: scan text for date indicators, web search, or current date as last resort.
- Enriched metadata is used in trade posts (source page author stays as-is).

**YouTube diarization decision:**

- Check title + description for multi-speaker indicators (guest names, "interview", "panel", "debate").
- If multi-speaker detected:
  - `GEMINI_API_KEY` available: run `diarize.ts`.
  - `GEMINI_API_KEY` missing: offer user a choice:
    1. Continue without speaker attribution (trades attributed to channel).
    2. Get a Gemini API key (link: https://aistudio.google.com/apikey), paste it, save to `.env` using `getPreferredEnvWritePath()` pattern from `ensure-key.ts`, then run `diarize.ts`.
- If not multi-speaker: read transcript from `saved_to`.

```bash
bun run scripts/diarize.ts "URL"
# Speaker labels + timestamps. Costs ~$0.14/hr. Writes to its own saved_to.
```

**Speaker identity resolution:**

- After reading content, if named speakers identified: web search for each speaker's X handle.
- Use resolved handles as `author_handle` on per-trade posts.
- Source-level author stays as channel (source = publisher, trade = quote author).
- Avatars not in scope: backend auto-resolves via `ensureAuthor` + `enqueueAssetJob`.

**Canonical transcript selection:**

- Default: use extract `saved_to`.
- If diarized: switch to diarize `saved_to`.
- Always read from the file path, not tool output.
- Upload full text once per run:

```bash
bun run scripts/upload-source-text.ts <source_id> --file <saved_to> --provider transcript
```

**Push enriched metadata:**

If enrichment resolved new metadata (author handle, source date, speakers, or thumbnail), push it now so the source page updates before thesis extraction:

```bash
bun run scripts/update-source.ts <source_id> --run-id <run_id> '{ "author_handle": "...", "source_date": "...", "thumbnail_url": "...", "speakers": [...] }'
```

### 4. Extract theses

Read the canonical source artifact and find every tradeable thesis.

A thesis is a directional belief about what changes and what that means for price.

Process:

1. First pass: read the source and list every directional belief, one line each, with the quote that most implies direction.
2. Second pass: for each belief, ideate 1-3 ways to trade it. These can be tickers, sectors, asset classes, or descriptions. Use web search if needed to clarify what's tradeable.
3. Third pass: save each thesis with its trade ideas as an unrouted record.

```json
{
  "thesis": "author's directional belief in one sentence, in your words not theirs",
  "horizon": "author's timing language, if any",
  "route_status": "unrouted",
  "unrouted_reason": "pending_route_check",
  "who": [
    { "ticker": "NVDA", "direction": "long" },
    { "ticker": "AI infrastructure companies", "direction": "long" }
  ],
  "why": ["reasoning step from author", { "text": "researched fact", "url": "...", "origin": "research" }],
  "quotes": ["exact words from source that anchor the thesis"],
  "headline_quote": "verbatim from quotes[], <=120 chars — frozen at extraction, post.ts validates exact match",
  "source_date": "ISO 8601 datetime when available (published_at), date-only fallback otherwise"
}
```

Research depth scales with source density:
- Dense source (podcast, article, PDF): the author did the thinking. Verify, price, and narrate.
- Sparse source (tweet, user thesis, screenshot): you are the analyst. Research deeply, consider 3+ instruments, and build the frame the source did not provide.

`who` captures 1-3 trade ideas per thesis. These are starting points for routing, not final selections. Can range from specific tickers to broad descriptions. During routing, `who` is overwritten with the final selected expression.

A thesis is one belief — if the same belief could be traded through different instruments, those are `who` entries, not separate theses.

For unresolved candidates, do not drop them. Save them as:

```json
{
  "thesis": "...",
  "route_status": "unrouted",
  "unrouted_reason": "no clean liquid instrument / weak directional expression / evidence gap",
  "who": [],
  "why": ["..."],
  "quotes": ["..."],
  "headline_quote": "..."
}
```

Narrate the thesis map to the live page after the first pass:

```bash
bun run scripts/stream-thought.ts --run-id <run_id> "Found 4 theses: oil supply risk, gold safe haven, defense spending will go up, Anthropic will win"
```

Save all theses from extraction in one batch call (pass `--total` on first save if using individual saves instead):

```bash
# Preferred — batch save all theses at once:
echo '[{...}, {...}]' | bun run scripts/batch-save.ts --run-id <run_id> --total 5
# Returns: [{ id, index }, ...]

# Individual save (when extracting one at a time):
bun run scripts/save.ts --run-id <run_id> --total 5 '<thesis JSON>'
# Returns: { id, file, count }

# Update a saved thesis (used during routing):
echo '<partial JSON>' | bun run scripts/save.ts --run-id <run_id> --update <id>
```

Track the returned thesis IDs — you'll need every one for finalization.

Each thesis routes independently. Parallelize routing across theses: run research,
instrument discovery, route, save, and post concurrently for all theses.
Save and post return `{"ok": false, "error": "..."}` on validation errors (exit 0),
so parallel calls are safe -- one failure does not cancel siblings. Always check the
`ok` field (or presence of `error`) in tool output before proceeding.
Do not use routing difficulty as a filter at extraction time. Capture first, then route or explicitly mark unrouted.

Long transcript handling:

- If transcript is chunked into 3+ parts (or word_count > 8,000), split extraction pass by chunk.
- Only parallelize chunk extraction when transcript size is clearly large (`word_count > 8,000` or transcript chars > 45,000).
- If below that threshold, do chunk extraction sequentially in the main thread.
- If you parallelize, workers are extraction-only: main thread must merge/dedupe, then do all save/update/post/finalize calls.

### 5. Route and price

For each thesis, determine the best executable expression on supported venues.
On adapter error, retry the failed step once. If it fails again, try an alternative ticker or skip the thesis.

#### 5a. Research

Supported venues:

- Hyperliquid
- Robinhood
- Polymarket

For each thesis, routing runs:

1. **Research** (run in parallel):
   - **Web search**: verify the thesis holds today, find developments, and research
     tradeable instruments for the ideas in `who`. Your training data is stale for
     tickers and listings. Search to find what's actually available.
     Cite findings in `why` as { "text": "...", "url": "...", "origin": "research" }.
   - **Instrument discovery** (`scripts/discover.ts --query "<keywords>"`):
     search available instruments across all venues (Hyperliquid + Polymarket) using
     terms from `who`. Works best with single concrete terms, not multi-word abstractions.
     Use `--catalog` for a full listing of non-crypto HL instruments.
   - **Source context** (`scripts/source-excerpt.ts --file <saved_to> --query "<thesis keywords>"`):
     retrieve surrounding context from the original source for this thesis.
     After extraction splits a source into theses, adjacent details get lost.
     Use this to find what the author said around each claim — qualifications,
     supporting numbers, competitive landscape, or nuance that strengthens
     the derivation. Also use `--around "<exact quote>"` to expand a specific quote.
2. **Route** (`scripts/route.ts`): validate the best candidates
   from both sources against supported venues and get pricing. Takes ticker symbols only.
3. **Select and save**: pick the expression with the tightest link between the source
   quote and the instrument. The trade ideas in `who` are starting context, not decisions.
   Routing may confirm them, improve on them, or find something better entirely.
   Prefer sector-level instruments over single equities for broad theses.
   Persist via `save.ts --update`.

Routing requirements:

- If a thesis is executable on both Hyperliquid and Robinhood, prefer Hyperliquid.
- If best trade is not one of the initially considered direct tickers, update
  thesis with explicit proxy reasoning and citations.
- Before final route, check quote-to-trade logic: if original author would not
  recognize the link, reroute.

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
        "publish_price": 12.54,
        "source_date_price": 12.525
      }
    ],
    "selected_expression": {
      "ticker": "SMR",
      "direction": "short",
      "instrument": "shares",
      "platform": "robinhood",
      "trade_type": "direct",
      "publish_price": 12.54,
      "source_date_price": 12.525,
      "since_published_move_pct": 0.12
    }
  }
}
```

Mapping rule from route output:

- `route.selected_expression.routed_ticker` -> `route_evidence.selected_expression.ticker`
- keep `instrument`/`platform` strings exactly as returned (`shares`/`perps`, `robinhood`/`hyperliquid`)
- if proxy route selected, include `fallback_reason_tag` (and `fallback_reason_text` when direct executable exists)

These fields cross-reference each other — `save.ts` validates consistency:
every `subjects[].label` needs a matching `direct_checks[].subject_label`,
and the selected ticker must appear in `who`. Include updated `who`,
`route_evidence`, and `derivation` in the same `--update` call.

#### 5b. Narrate

Build a derivation chain for every routed trade:

```json
{
  "explanation": "Lead with the sharpest insight, not a company description. Show why this instrument won over alternatives.",
  "comparison": {
    "question": "Which chipmaker benefits most from AI infrastructure buildout?",
    "candidates": [
      { "ticker": "NVDA", "label": "Nvidia", "case": "Controls 90% of AI training via CUDA lock-in. Next earnings Apr 28.", "catalyst": "Earnings Apr 28", "selected": true },
      { "ticker": "AMD", "label": "AMD", "case": "Gaining data center share but MI300 adoption still proving out", "catalyst": "MI300 ramp Q2" },
      { "ticker": "INTC", "label": "Intel", "case": "Foundry pivot — execution risk, revenue declining 8% YoY" }
    ],
    "reasoning": "NVDA's CUDA moat makes it the direct play. AMD is the second-order bet on competition emerging."
  },
  "segments": [
    { "quote": "verbatim source quote", "speaker": "speaker name", "speaker_handle": "@handle" }
  ],
  "steps": [
    { "text": "reasoning grounded in source", "segment": 0 },
    { "text": "researched fact", "url": "https://..." },
    { "text": "inference: skill's own reasoning" }
  ]
}
```

Write an `explanation` for every routed trade. Lead with the sharp insight,
not the safe summary. "NVDA's moat is the CUDA ecosystem" not "NVDA is a
semiconductor company." Your thinking shows you reason sharply — do not
flatten that into generic analysis. The explanation is the primary display;
steps become provenance metadata.

Explanation voice:
- When you evaluated multiple candidates, show why the winner won — not just why it fits.
- Reader's first question decides the frame: "Why this ticker?" → show the comparison. "When do catalysts hit?" → show the calendar. "How does quote become trade?" → show the connection.
- Write assertively. Hedge with data ("down 70% on GLP-1 fears"), not with qualifiers ("it could potentially benefit").

Steps should earn the conclusion, not summarize it. If the author named the
ticker, the chain can be short. If routing required a leap, earn it. If a
number is the argument, show the number — don't describe it in prose.

When routing a sparse source where you are selecting the instrument
(not the author), research what's happening NOW for each candidate:
upcoming earnings, product launches, regulatory decisions, central
bank meetings, contract announcements. Between candidates with equal
thesis fit, the one with a concrete near-term catalyst is more
actionable.

`catalyst` is a concrete event + date: "Earnings Apr 28",
"Fed decision Jun 12", "product launch Q2". Omit when no concrete
event exists — absence doesn't disqualify, but it means the trade
lacks a near-term timing anchor.

`case` is thesis-relative: argue why this ticker captures (or fails
to capture) the source thesis. One-liner for rejects, detailed for
contenders.

Rules:

- Provenance: has `segment` = sourced from quote, has `url` = backed by research, has neither = agent inference
- when a step depends on external research or a factual check, embed the source inline as `[phrase](url)`; treat this as part of the format, not decoration
- `url` on a step is a fallback when inline linking does not fit
- 2-5 steps
- be honest when a step is your own inference
- user thesis: their words are the segment, `speaker: "user"`
- video/podcast: include timestamps; resolve speaker X handles when it materially helps attribution

#### 5c. Price and save

Instrument preference:

- Direct thesis subject on Hyperliquid -> perps
- Otherwise direct thesis subject via shares
- If no direct executable route, use the best proxy

Pricing (same `route.ts`, with date flags):

```bash
bun run scripts/route.ts --run-id <run_id> --thesis-id <id> TICKER direction --source-date "ISO-8601-datetime-or-YYYY-MM-DD" --horizon "timing"
# Returns: { tool: "route", route: { ticker, direction, executable, selected_expression, alternatives, price_context, candidate_routes, note }, diagnostics }
# selected_expression: { platform, instrument, routed_ticker, publish_price }
# price_context: { current_price, source_date, source_date_price, since_published_move_pct }
# If perps route selected and routed_ticker is provided, post that routed_ticker as ticker.
```

Use tool numbers directly. Do not estimate or recompute.

After routing completes for a thesis, persist everything in one update — `who` (updated to final ticker), `route_status`, `route_evidence`, and `derivation` together:

```bash
echo '<JSON with who + route_evidence + derivation>' | bun run scripts/save.ts --run-id <run_id> --update <id>
```

This emits `thesis_routed` (or `thesis_dropped`) events automatically, updating the live source page with explanation and comparison data as each thesis resolves.

### 6. Post and finalize

Post each trade:

```bash
echo '<JSON payload>' | bun run scripts/post.ts --run-id <run_id>
```

Post rules:

- `headline_quote` must be an exact string match to one of saved `quotes[]`.
- Posted `ticker`, `direction`, `instrument`, `platform`, and `trade_type` must match `route_evidence.selected_expression`.
- Carry `source_date_price` and `since_published_move_pct` from route `price_context` whenever present.
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
| `ticker` | If route selected expression returns `routed_ticker`, use that ticker |
| `direction` | `"long"` or `"short"` |
| `publish_price` | Stocks/perps: `source_date_price` from route price context |
| `source_date_price` | Required for baseline P&L. Use route `price_context.source_date_price` |
| `since_published_move_pct` | Required when available. Use route `price_context.since_published_move_pct` |
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
| `derivation` | `{ explanation, comparison?, segments, steps }` |

Top-level source fields:

- `source_title`: title/headline when the source has one
- `source_images`: image URLs extracted from the source

Finalization-only fields:

- `source_theses`: all theses from this source, passed to `finalize-source.ts`
- `source_summary`: one-line source summary, passed to `finalize-source.ts`

Useful optional `trade_data` fields:

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

## Hard Rules

1. Use "trades" and "market data", never "recommendations" or "advice"
2. Every number must come from a tool
3. Bear theses -> short-side instruments
4. Flag illiquid contracts
