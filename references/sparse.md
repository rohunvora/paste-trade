# Sparse Source Path

Rules for sparse sources: tweets, user-typed theses, screenshots, single claims.
Read when SKILL.md routes here at §6. Handles extraction through routing (§6-§9).
Return to SKILL.md at §10 Post.

## 

You will use the sparse source as the starting point to fill out the thesis.json by using Reasoning Tree.

Sparse source exact words become `headline_quote` and `quotes[]` never paraphrase the user's input. Your interpretation goes in `thesis`. Skip three-pass extraction. Work the tree below.



## Fill this out

```json
{
  "route_status": "routed",
  "who": [{ "ticker": "<final ticker>", "direction": "long|short" }],
  "route_evidence": {
    "subjects": [{ "label": "<asset name>", "subject_kind": "asset|company|event" }],
    "direct_checks": [
      {
        "subject_label": "<asset name>",
        "ticker_tested": "<final ticker>",
        "executable": true,
        "author_price": "<from route price_context>"
      }
    ],
    "selected_expression": {
      "ticker": "<final ticker>",
      "direction": "long|short",
      "instrument": "perps|shares|polymarket",
      "platform": "hyperliquid|robinhood|polymarket",
      "trade_type": "direct|derived",
      "author_price": "<from route price_context>"
    }
  },
  "derivation": { "explanation": "...", "segments": [...], "steps": [...] }
}
```

Validation: every `subjects[].label` needs a matching `direct_checks[].subject_label`, and the selected ticker must appear in `who`.



## List detection

If the source lists items that need independent reasoning chains — distinct
commodities, opposing directions, or unrelated tickers — each is a separate
thesis. Items that share the same belief and catalyst are one thesis with
multiple `who` entries. Extract all theses, save with `batch-save --total N`,
then run the tree below per thesis.

## Take the original source and run this process:

```
SPARSE SOURCE
│
├─ Is this breaking news or new information?
│  YES → Read `skill/references/fast.md` and follow it.
│    Returns to SKILL.md §10 Post when done.
│  NO → Continue below.
│
├─ What is the person actually saying?
│  ├─ What are they NOT saying that it sounds like?
│  └─ Translate into hypothesis.
│
├─ Decompose
│  ├─ What pumps hardest if the hypothesis is right?
│  ├─ What are the 2nd order effects?
│  └─ What are the best possible trades? → `who` entries (1-3)
│
├─ SAVE
│  echo '[{...}]' | batch-save.ts --run-id <run_id> --total <N>
│  Track thesis ID for route.ts and save --update.
│  stream-thought.ts --run-id <run_id> "Researching..."
│
├─ SEARCH (parallel) ←─────────────────────────────┐
│  discover.ts --query "<term>" per who entry        │
│    Prefer reference_symbols matches for HIP-3.     │
│    --catalog for full non-crypto HL listing.        │
│  discover.ts --query "<event/catalyst keywords>"   │
│    --platform polymarket                            │
│    Always run this alongside HL discovery.          │
│    Use the event noun, not the ticker.              │
│  Web search: verify thesis, find catalysts          │
│    Cite: { "text", "url", "origin": "research" }   │
│  Check hl-universe.md for HL upgrades over ETFs    │
│  Check prediction-markets.md for binary events     │
│  Search for the investment thesis, not the news     │
│                                                     │
├─ EVALUATE                                           │
│  For each candidate:                                │
│    Reasoning chain from belief to trade?             │
│    Is there a better trade?                         │
│  If PM contract found (>$50K vol) that prices the   │
│    event/catalyst → add as separate thesis.          │
│  If gaps → loop back to SEARCH ─────────────────────┘
│  Then pick 1-3. No redundant routes.
│
├─ PICK
│  Prefer: HL perps > HL thematic > shares > proxy
│  ETF tickers: discover.ts --query "TICKER" for HL perp equivalent.
│  PM is additive: post alongside price trades, not instead of.
│  PM skip: only when no relevant contract exists.
│  Clearest reasoning chain from thesis to trade
│  Upcoming catalyst
│  Tightest link between source quote and instrument
│  direct = author recognizes it
│  derived = author didn't name it, but link is defensible
│
├─ ROUTE
│  route.ts --run-id <run_id> --thesis-id <id> TICKER direction
│    --source-date "now" --horizon "timing"
│  Use tool prices directly. Do not recompute.
│  routed_ticker from route output → ticker in route_evidence
│
├─ NARRATE
│  explanation: 1-2 sentences, plain English, no em dashes
│  segments: [{ quote: "user's words", speaker: "user" }]
│  steps: 2-4, earn the conclusion
│    every step must advance the chain. if you can
│    remove it and the conclusion still follows, cut it
│    has segment → sourced from quote
│    has url or [1](url) → backed by research
│    has neither → your inference (be honest)
│
├─ UPDATE
│  save.ts --update <id> with:
│    who + route_status + route_evidence + derivation
│  Keep instrument/platform strings exactly as returned.
│  If proxy: include fallback_reason_tag.
│  Emits thesis_routed automatically.
│
└─ Return to SKILL.md §10 Post
```



