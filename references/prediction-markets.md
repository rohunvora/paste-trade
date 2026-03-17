# Prediction Markets

Polymarket offers binary contracts on real-world events. Each contract resolves
to $1 (yes) or $0 (no) on a specific date. The current price IS the market's
implied probability — a contract trading at $0.35 means the market prices the
event at 35% likely.

## Why prediction markets matter for routing

When a thesis is fundamentally about whether something WILL or WON'T happen,
a prediction market contract is often the sharpest possible expression:

- **Purity**: A PM contract on "will the Fed cut rates in June" prices exactly
  that question. A TLT position also responds to term premium, supply/demand,
  duration, and a dozen other factors. The PM contract isolates the thesis.

- **Asymmetry**: Buying a YES contract at $0.15 returns 567% if right.
  The equivalent stock trade might return 5-15% on the same catalyst.
  PM contracts offer naturally asymmetric payoffs on binary events.

- **Time-bounded**: Every PM contract has a resolution date. This forces
  clarity — the thesis either plays out by then or it doesn't.
  Stock positions can drift indefinitely without resolution.

- **Directness**: "Will China invade Taiwan by end of 2026?" at $0.11
  is the purest expression of a Taiwan risk thesis. Shorting TSM also
  captures demand cycles, tariffs, execution risk — all noise relative
  to the invasion question.

## When a thesis fits prediction markets

The signal is in the thesis structure, not the topic:

**Strong PM fit** — thesis is about a binary event:
- "The Fed will cut rates" → specific FOMC meeting decision contracts
- "US will strike Iran" → strike-by-date contracts
- "There will be a recession" → recession-by-date contracts
- "SpaceX will IPO this year" → IPO-by-date contracts
- "This company's earnings will beat" → earnings outcome contracts

**Weak PM fit** — thesis is about direction or magnitude:
- "NVDA will outperform AMD" → no PM contract for relative performance
- "Gold will keep rising" → PM has price-level contracts ($5000, $6000)
  but these test specific targets, not sustained direction
- "SaaS is dying" → no PM market for sector-level disruption narratives

**No PM fit** — thesis is structural or untimed:
- "AI will replace knowledge work" → too broad, no resolution criteria
- "This company has a durable moat" → structural thesis, no event

The key question: **does the thesis resolve to yes or no on a specific date?**
If yes → check PM. If it's about magnitude, direction, or structure → equity/perp
is probably the right vehicle.

## How to search

Run `discover.ts --query "<event keywords>"` — this searches both Hyperliquid AND
Polymarket in parallel. PM results appear under the Polymarket section.

Search tips:
- Use the event noun, not the stock: "recession" not "SPY", "Fed rate cut" not "TLT"
- Try multiple phrasings: "Iran strike", "Iran nuclear", "US attack Iran"
- Check volume — markets under $10K volume may have execution issues
- Look at the resolution date — match it to the thesis horizon

## Evaluating a PM contract vs an equity route

When both a PM contract and an equity position could express the thesis,
consider:

1. **Is the thesis about the event or about the asset?**
   "US will strike Iran" → PM (the event is the thesis)
   "Oil will spike because of Iran tensions" → could go either way — PM for
   the catalyst, crude oil perp for the price outcome, or both as complements

2. **What's the payoff shape?**
   PM: binary, asymmetric (buy at $0.20, win $1 or lose $0.20)
   Equity/perp: continuous, symmetric-ish
   If the thesis has a clear yes/no structure, PM's asymmetry is an advantage

3. **What's the horizon?**
   PM contracts expire. If the thesis is "eventually" rather than "by June",
   an equity position may be better because it doesn't expire worthless on
   a missed deadline

4. **Liquidity**
   Fed rate decision markets: $100M+ volume — highly liquid
   Niche geopolitical markets: $5K-$50K — thin but tradeable for small size
   If volume is below $1K, flag it as low-liquidity

5. **Don't retreat from cheap contracts**
   A low PM price means the market disagrees with your thesis — that's
   where the asymmetry comes from. If your analysis says "no rate cuts"
   and the contract is at 17¢, that's a 478% payout if you're right,
   not a warning sign. Evaluate the thesis, not the consensus.

## Posting a PM trade

When routing to Polymarket, the trade needs specific fields:

**Top-level fields:**
- `ticker`: the market slug from discover.ts output (e.g., "us-recession-by-end-of-2026"). Never invent a slug — use exactly what discover.ts returned.
- `platform`: "polymarket"
- `instrument`: "polymarket" (this is `trades.instrument`, not `tickers.instrument_type`)
- `author_price`: set to the contract price (0-1)
- `direction`: "long" means buying YES, "short" means buying NO
- `pm_side`: "yes" or "no" — captured automatically by post.ts from direction before normalization

**Stored in `trade_data` JSON:**
- `pm_yes_no_price`: the contract price (0-1 range)
- `pm_side`: "yes" or "no" — which contract was bought
- `market_slug`: for deeplinks back to Polymarket
- `condition_id`: **required** — the contract identifier from discover.ts results. Without this, the trade cannot price. Copy verbatim from discover.ts output.
- `market_question`: the full market question text
- `end_date`: resolution date

Do NOT call `enrichBaselineViaAssess` for PM trades — it calls `/api/skill/assess`
which internally uses Yahoo Finance and will corrupt the PM contract price.
The contract price from the PM market IS the canonical `author_price`.
