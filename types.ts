/**
 * Core types for the Belief Router skill.
 * Every adapter produces TradeExpression objects with the same shape,
 * enabling cross-platform comparison.
 */

export type Platform = "hyperliquid" | "robinhood" | "polymarket";
export type Direction = "long" | "short" | "yes" | "no";
export type Liquidity = "high" | "medium" | "low";
export type ThesisDirection = "bullish" | "bearish" | "neutral";
export type PlatformRiskTier = "regulated" | "dex";

/** Parsed thesis from natural language input */
export interface ParsedThesis {
  raw: string;                    // Original user input
  direction: ThesisDirection;     // Bullish, bearish, or neutral
  confidence: number;             // 0-1, user's stated or inferred conviction
  time_horizon?: string;          // "3 months", "by Dec 2027", etc.
  sectors: string[];              // ["defense", "AI"] or ["crypto", "defi"]
  keywords: string[];             // Extracted for adapter matching
}

/** The core data object — every adapter returns these */
export interface TradeExpression {
  platform: Platform;
  instrument: string;             // "PLTR-PERP", "KXFED-26MAR T3.50", "BAH", "ONDO"
  instrument_name: string;        // Human-readable: "Palantir 5x Perp", "Fed holds in March"
  direction: Direction;

  // The three numbers that matter
  capital_required: number;       // $ in (normalized to $100 for comparison)
  return_if_right_pct: number;    // % gain if thesis correct
  return_if_wrong_pct: number;    // % loss if thesis wrong (negative number)

  // Context
  time_horizon: string;           // "by March 18, 2026", "3-6 months"
  leverage: number;               // 1x spot, 5x perp, binary = effectively infinite
  market_implied_prob?: number;   // From Polymarket price, or estimated
  liquidity: Liquidity;

  // The ranking metric: expected return per month per $100
  expected_return_monthly?: number;

  // Platform-specific execution data (Layer 3)
  execution_details: Record<string, any>;
}

/** What each adapter's instruments.ts exports */
export interface AdapterInstrumentResult {
  platform: Platform;
  instruments: InstrumentMatch[];
  search_method: string;          // How we found them: "series_ticker", "perp_list", "curated_list", "prompt"
}

export interface InstrumentMatch {
  ticker: string;                 // Platform-native ticker
  name: string;                   // Human-readable name
  relevance: "direct" | "proxy" | "lateral";  // How closely it maps to the thesis
  why: string;                    // One-line explanation: "Direct Fed rate contract for March FOMC"
}

/** What each adapter's returns.ts exports */
export interface ReturnProfile {
  expression: TradeExpression;
  confidence_note: string;        // "Market implies 35% probability. Your thesis needs >35% to be +EV."
  risk_note: string;              // "Leveraged position — liquidation at $X"
}

/** PnL tracking — the "I Called It" card (thesis leads, not the number) */
export interface TrackedTrade {
  id: string;
  thesis: string;                 // Original belief text — the headline
  thesis_timestamp: string;       // ISO date when belief was stated
  expression: TradeExpression;    // What they picked
  entry_price: number;
  entry_date: string;             // ISO date
  current_price?: number;
  pnl_pct?: number;
  pnl_dollars?: number;
  status: "open" | "closed" | "expired";
  mode: "paper" | "real";          // Paper trade or actually executed
  kill_conditions?: string[];      // From the trade card — monitor these
  targets?: TradeTarget[];         // Price levels to alert on
}

export interface TradeTarget {
  price: number;
  label: string;                   // "1.4x", "52w high", "liquidation"
  direction: "above" | "below";
  triggered?: boolean;
}

/** Platform risk metadata — surfaced on every card */
export const PLATFORM_RISK: Record<Platform, { tier: PlatformRiskTier; note: string }> = {
  robinhood: { tier: "regulated", note: "FINRA/SEC regulated broker-dealer" },
  hyperliquid: { tier: "dex", note: "DEX on Arbitrum — 3 withdrawal freezes in 2025 (JELLY, July, POPCAT)" },
  polymarket: { tier: "dex", note: "Crypto-native prediction market on Polygon, no CFTC regulation" },
};
