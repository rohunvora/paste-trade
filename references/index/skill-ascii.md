# SKILL.md ASCII Map

Uses the same section references as `SKILL.md`, `skill-index.md`, `dense.md`, and `sparse.md`.

```text
                                   SKILL.md FLOW MAP

                             [0 - Intro | lines 16-20]
                     live-thinking posture + supporting references
                                          |
                                          v
                            [1 - Defaults | lines 22-29]
                    venue bias + single-trade bias + copy defaults
                                          |
                 +------------------------+------------------------+
                 |                                                 |
                 v                                                 v
                      [2 - Chat UX | lines 31-36]      [13 - Hard Rules | lines 479-484]
                run-start status + live-link copy      wording + numbers + directionality
                 ^                                                 ^
                 |                                                 |
                 +------------------------+------------------------+
                                          |
                                          v
                           [3 - Classify | lines 40-44]
                         choose URL path or direct-thesis path
                                /                        \
                               /                          \
                              v                            v
                [URL/source path]                    [user-thesis path]
                              |                            |
                              v                            |
                       [4 - Extract | lines 46-85]         |
          raw URL -> extract output -> source run          |
                              |                            |
                              +---> [2 - Chat UX]          |
                              | live link, then continue   |
                              |                            |
                              v                            |
                       [5 - Enrich | lines 87-110]         |
                    metadata + dense.md diarization         |
                              |                            |
                              v                            v
                       [6 - Theses | lines 112-191]
                       branch by source density:
                                /                \
                               /                  \
                              v                    v
                  ┌─ dense.md ──────┐   ┌─ sparse.md ─────────┐
                  │ self-contained  │   │ self-contained       │
                  │ §5-§9 sub-loop  │   │ §6-§9 sub-loop      │
                  │                 │   │                      │
                  │ d-1 Enrich      │   │ Decompose thesis     │
                  │ d-2 Extract     │   │ Save                 │
                  │   (3-pass,      │   │ Search (parallel)    │
                  │    chunking)    │   │ Evaluate             │
                  │                 │   │ Pick                 │
                  │ per thesis:     │   │ Route                │
                  │ d-3 Route loop  │   │ Narrate              │
                  │  d-4 Research   │   │ Update               │
                  │  d-5 Evaluate   │   │                      │
                  │  d-6 Route      │   │ returns with:        │
                  │  d-7 Narrate    │   │  route_evidence      │
                  │  d-8 Validate   │   │  derivation          │
                  │                 │   │  who (final)         │
                  │ returns with:   │   │                      │
                  │  route_evidence │   └──────────┬───────────┘
                  │  derivation     │              |
                  │  who (final)    │              |
                  │                 │              |
                  └────────┬───────┘              |
                           |                      |
                           +----------+-----------+
                                      |
                                      v
                        [10 - Post | lines 371-403]
                   route package -> post payload + finalize
                                      |
                                      v
                     [11 - Contract | lines 405-451]
                   field-level shape for post/finalize payloads
                                      |
                    +-----------------+-----------------+
                    |                                   |
                    v                                   v
              [12 - Reply | lines 453-477]   [13 - Hard Rules | lines 479-484]
             final chat block from saved data  still applies here
```

```text
SECTION DETAIL

[0 - Intro]
  |- run posture
  `- supporting refs

[1 - Defaults]
  |- risk framing
  |- venue preference
  |- best single trade
  `- copy defaults

[2 - Chat UX]
  |- run-start status
  |- transcript-duration status
  `- live-link status

[3 - Classify]
  |- URL source -> 4 - Extract
  |- user thesis -> 6 - Theses
  `- paste.trade URL -> treat as normal source

[4 - Extract]
  |- Execution sequence
  |- Notes
  `- outputs: extract output + source run

[5 - Enrich]
  |- Timing
  |- Metadata
  `- Dense source enrichment (-> dense.md d-1)

[6 - Theses]
  |- Core
  |- Branch: dense -> dense.md, sparse -> sparse.md
  |- Who field
  `- Save and parallel

  dense.md (self-contained §5-§9)
  |- d-1 Enrich: diarize, speakers, transcript selection
  |- d-2 Extract: 3-pass, decompose, batch-save, chunking
  |- d-3 Route loop (per thesis, parallel):
  |  |- d-4 Research: discover + source-excerpt + web search
  |  |- d-5 Evaluate + select: instrument preference, directness
  |  |- d-6 Route + price: route.ts, mapping rules
  |  |- d-7 Narrate: derivation chain (2-4 steps, filler test)
  |  `- d-8 Validate and save: consistency checks, thesis_routed event
  `- returns to SKILL.md §10

  sparse.md (self-contained §6-§9)
  |- Decompose: hypothesis, 2nd order effects, who entries
  |- Save: batch-save, stream-thought
  |- Search: discover + web search (parallel, with loop-back)
  |- Evaluate + Pick: instrument preference, directness
  |- Route: route.ts, price context
  |- Narrate: derivation chain (2-4 steps, filler test)
  |- Update: save --update with full route package
  `- returns to SKILL.md §10

[7-9 in SKILL.md are fallback references]
  §7 Research, §8 Narrate, §9 Price exist in SKILL.md
  but dense.md and sparse.md handle these internally
  as d-3..d-8 and Search..Update respectively.

[10 - Post]
  |- Post rules
  `- Finalization

[11 - Contract]
  |- Required fields
  |- Source fields
  `- Notes

[12 - Reply]
  `- final response format

[13 - Hard Rules]
  `- cross-cutting guardrails
```
