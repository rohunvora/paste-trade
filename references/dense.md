# Dense Source Path

Rules for dense sources: podcasts, articles, PDFs, long-form video.
Read when SKILL.md routes here at §5. Handles enrichment through routing (§5-§9).
Return to SKILL.md at §10 Post.

The author did the thinking. Your job: verify, price, and narrate.

## d-1 Enrich

- Check title + description for multiple speakers with competing or independent market views (panels, debates, co-hosted roundtables — not single-guest interviews).
- If multi-speaker detected:
  - `GEMINI_API_KEY` available: run `diarize.ts`.
  - `GEMINI_API_KEY` missing: skip diarization. The key check was already offered at §4 before source creation. Continue with channel attribution.
- If not multi-speaker: read transcript from `saved_to`.

```bash
bun run skill/scripts/diarize.ts --run-id <run_id> "URL"
# Speaker labels + timestamps. Costs ~$0.14/hr. Writes to its own saved_to.
# Long-running: use 5 min timeout for videos up to 50 min.
```

After diarization completes, stream the result:

```bash
bun run skill/scripts/stream-thought.ts --run-id <run_id> "Diarized N speakers: Name, Name, Name"
```

After reading content, if named speakers identified: web search for each speaker's X handle.
Use resolved handles as `author_handle` on per-trade posts.
Source-level author stays as channel (source = publisher, trade = quote author).

```bash
bun run skill/scripts/stream-thought.ts --run-id <run_id> "Speakers: Name (@handle), Name (@handle)"
```

**Transcript selection:**

- Default: use extract `saved_to`.
- If diarized: switch to diarize `saved_to`.
- Always read from the file path, not tool output.
- Upload full text once per run:

```bash
bun run skill/scripts/upload-source-text.ts <source_id> --file <saved_to> --provider transcript
```

## d-2 Extract

Read the canonical source artifact and find every tradeable thesis.

**First pass**: list every directional belief, one line each, with the quote that most implies direction and the speaker who said it.

A 30+ minute video or 3,000+ word article with fewer than 3 beliefs listed
almost certainly means you stopped at the dominant thesis. Re-read for
secondary claims: different asset classes, second-order effects the speaker
called out, or contrarian positions they argued against.

**Per belief, decompose**:
- What pumps hardest if the directional belief is right?
- What are the 2nd order effects?
- Best possible trades? → `who` entries (1-3)
- Use surrounding transcript context to sharpen.
- Use web search if needed to clarify what's tradeable.

**Stream your first-pass analysis** before saving. This is what the user reads while research runs:

```bash
bun run skill/scripts/stream-thought.ts --run-id <run_id> "<your first-pass breakdown — the beliefs you found, the framework, what's interesting>"
```

**Save all theses in one batch:**

```bash
echo '[{...}, {...}]' | bun run skill/scripts/batch-save.ts --run-id <run_id> --total N
# Track every returned thesis ID.
```

**Thesis map** (narrate to the live page):

```bash
bun run skill/scripts/stream-thought.ts --run-id <run_id> "Found N theses: oil supply risk, gold safe haven, ..."
```

**Long transcripts**: if word_count > 8,000 or transcript chars > 45,000, split extraction by chunk. Workers extract only; main thread merges/dedupes, then handles all save/update/post/finalize. Below threshold: extract sequentially.

## d-3 Route each thesis (parallel)

Target output per thesis. This is what each routed thesis looks like when complete:

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
        "author_price": 12.54
      }
    ],
    "selected_expression": {
      "ticker": "SMR",
      "direction": "short",
      "instrument": "shares",
      "platform": "robinhood",
      "trade_type": "direct",
      "author_price": 12.54
    }
  },
  "derivation": { "explanation": "...", "segments": [...], "steps": [...] }
}
```

Validation: every `subjects[].label` needs a matching `direct_checks[].subject_label`, and the selected ticker must appear in `who`.

All theses route independently. On adapter error, retry the failed step once. If it fails again, try an alternative ticker or skip the thesis.

```
SAVED THESIS (speaker: "quote")
│
├─ stream-thought "Researching: [thesis text or headline_quote]"
│
├─ d-4 Research (run in parallel)
│
├─ d-5 Evaluate + select
│    stream-thought "Routing [headline_quote snippet] → TICKER direction"
│
├─ d-6 Route + price
│
├─ d-7 Narrate
│
├─ d-8 Validate and save
│    thesis_routed emitted automatically by save.ts
│
└─ → SKILL.md §10 Post
```

### d-4 Research

Per thesis, stream what you're researching:

```bash
bun run skill/scripts/stream-thought.ts --run-id <run_id> "Researching: [thesis text or headline_quote]"
```

Run all three in parallel for each thesis:

1. **Instrument discovery** (`skill/scripts/discover.ts --run-id <run_id> --thesis-id <thesis_id> --query "<keywords>"`):
   search available instruments across all venues (Hyperliquid + Polymarket) using
   terms from `who`. Works best with single concrete terms, not multi-word abstractions.
   Use `--catalog` for a full listing of non-crypto HL instruments.
   For HIP-3/non-crypto results, prefer entries whose `reference_symbols` and
   `routing_note` show the same ETF, benchmark, commodity, or private company
   the thesis is really about.
   If discover returns irrelevant results, ignore them.

2. **Source context** (`skill/scripts/source-excerpt.ts --run-id <run_id> --thesis-id <thesis_id> --file <saved_to> --query "<thesis keywords>"`):
   retrieve surrounding context from the original source for this thesis.
   After extraction splits a source into theses, adjacent details get lost.
   Use this to find what the author said around each claim: qualifications,
   supporting numbers, competitive landscape, or nuance that strengthens
   the derivation. Also use `--around "<exact quote>"` to expand a specific quote.

3. **Web search**: verify the thesis holds today, find developments, and research
   tradeable instruments for the ideas in `who`. Your training data is stale for
   tickers and listings. Search to find what's actually available.
   Cite findings in `why` as `{ "text": "...", "url": "...", "origin": "research" }`.
   Search for the investment thesis, not the news.

**Venue upgrades:**

- **ETFs and broad-sector stocks**: Hyperliquid often has a thematic index or
  commodity perp tracking the same underlying with leverage and no ETF overhead.
  Run `discover.ts --query "<theme>"` to check. See `skill/references/hl-universe.md`.
- **Event-driven theses**: Polymarket may have a binary contract that directly
  prices the catalyst. Run `discover.ts --query "<event keywords>"` to check.
  See `skill/references/prediction-markets.md`.
- If a better venue exists, route there and present the original as an alternative.

### d-5 Evaluate + select

After selecting the expression, stream the routing decision:

```bash
bun run skill/scripts/stream-thought.ts --run-id <run_id> "Routing [headline_quote snippet] → TICKER direction"
```

For each candidate: is there a clear reasoning chain from the speaker's belief to this trade? Is there a better trade? If gaps, loop back to d-4 Research. Then pick 1-2 per thesis. No redundant routes.

The trade ideas in `who` are starting context, not decisions. Routing may confirm them, improve on them, or find something better entirely. Pick the expression with the tightest link between the source quote and the instrument.

**Instrument preference:**

- Direct thesis subject on Hyperliquid → perps
- ETF tickers → run `discover.ts --query "TICKER"` to check for an HL perp on the same underlying. Route the HL perp, not the ETF.
- Sector/commodity/index thesis with HL thematic equivalent → HL perps
  (not when author named a specific company; their thesis is the company, not the sector)
- Thesis contingent on a binary event with a Polymarket contract → prediction market
  Compare the `resolution` field from discover results against the thesis.
  (skip Polymarket unless there's an underlying yes/no question or catalyst date)
- Otherwise direct thesis subject via shares
- If no direct executable route, use best proxy
- Sector-level instruments over single equities for broad theses
- If a thesis is executable on both Hyperliquid and Robinhood, prefer Hyperliquid

**Directness:**

- `direct`: speaker's subject is unambiguous. They would recognize this as their trade ("Apple will crush earnings" → AAPL is direct even though they didn't say the ticker).
- `derived`: author did not name it, but market link is immediate and defensible. Reasoning distance from the speaker's stated belief, not just whether they named a ticker.

**Requirements:**

- If best trade is not one of the initially considered direct tickers, update thesis with explicit proxy reasoning and citations.
- Before final route, check quote-to-trade logic: if original author would not recognize the link, reroute.

### d-6 Route + price

```bash
bun run skill/scripts/route.ts --run-id <run_id> --thesis-id <id> TICKER direction \
  --source-date "<source_date>" --horizon "timing"
# Returns: { tool: "route", route: { ticker, direction, executable, selected_expression,
#   alternatives, price_context, candidate_routes, note }, diagnostics }
# selected_expression and candidate_routes include HIP-3 routing metadata (see routing.md).
# price_context: { current_price, source_date, author_price }
# If perps route selected and routed_ticker is provided, post that routed_ticker as ticker.
```

Takes ticker symbols only. Use tool prices directly. Do not estimate or recompute.

**Mapping rule from route output:**

- `route.selected_expression.routed_ticker` → `route_evidence.selected_expression.ticker`
- keep `instrument`/`platform` strings exactly as returned (`shares`/`perps`, `robinhood`/`hyperliquid`)
- if proxy route selected, include `fallback_reason_tag` (and `fallback_reason_text` when direct executable exists)

### d-7 Narrate

Build a derivation chain for every routed trade:

```json
{
  "explanation": "1-2 sentences that explain the trade in plain English. No em dashes.",
  "segments": [
    { "quote": "speaker's verbatim words", "speaker": "speaker name", "speaker_handle": "@handle", "timestamp": "14:22", "source_url": "https://..." }
  ],
  "steps": [
    { "text": "reasoning grounded in source", "segment": 0 },
    { "text": "researched fact", "url": "https://..." },
    { "text": "inference: skill's own reasoning" }
  ]
}
```

Write an `explanation` for every routed trade. Lead with the sharp insight and explain the reasoning in 1-2 sentences. This is the short summary near the quote; steps are the full chain.

Steps should earn the conclusion, not summarize it. If the speaker named the ticker, the chain can be short. If routing required a leap, earn it. When a step depends on external research or a factual check, cite it with numbered inline citations in Markdown: `[1](url)`, `[2](url)`. Include timestamps when available.

**Rules:**

- Provenance: has `segment` = sourced from quote, has `url` = backed by research, has neither = agent inference
- When a step depends on external research or a factual check, embed the source inline as numbered Markdown citations: `[1](url)`, `[2](url)`; treat this as part of the format, not decoration
- `url` on a step is a fallback when numbered inline linking does not fit
- 2-4 steps. Each step must advance the chain. If you can remove a step and the conclusion still follows, it was filler.
- At least one step must cite external research (web search, not the source itself). A derivation backed only by speaker quotes is a restatement, not a verified thesis.
- Be honest when a step is your own inference
- Video/podcast: every segment MUST include `timestamp` (MM:SS or H:MM:SS from diarized transcript) and `source_url` (the video URL). These power click-to-seek on the source page. Resolve speaker X handles when it materially helps attribution.
- Can cite surrounding context recovered by source-excerpt

### d-8 Validate and save

Before calling `save.ts --update`, verify:

- [ ] `who[]` updated to final routed ticker + direction
- [ ] `route_status` = `"routed"`
- [ ] Every `subjects[].label` has a matching `direct_checks[].subject_label`
- [ ] Selected ticker appears in `who`
- [ ] `instrument`/`platform` strings match route output exactly (`shares`/`perps`, `robinhood`/`hyperliquid`)
- [ ] If proxy: `fallback_reason_tag` present (+ `fallback_reason_text` when direct executable exists)
- [ ] `derivation` includes `explanation`, `segments`, and `steps`

These fields cross-reference each other. `save.ts` validates consistency. Include updated `who`, `route_evidence`, and `derivation` in the same `--update` call.

```bash
echo '<JSON with who + route_evidence + derivation>' | bun run skill/scripts/save.ts --run-id <run_id> --update <id>
```

Emits `thesis_routed` (or `thesis_dropped`) events automatically, updating the live source page with derivation data as each thesis resolves.
