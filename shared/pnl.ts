/**
 * Canonical P&L calculation — single source of truth.
 *
 * Two lenses:
 *   - computeAuthorPnl:  base = author_price  (measures author's skill)
 *   - computePostedPnl:  base = posted_price   (measures platform value)
 *
 * Both use the same math. The only difference is which cached price is the base.
 */

/**
 * Derive pm_side from trade_data blob fields.
 * Centralizes the fallback logic: explicit pm_side → infer from buy_price_usd + direction → null.
 * Used by db-helpers (unpackRow), feed-ranking (fetchRankableTrades), leaderboard-refresh.
 */
export function derivePmSide(
  tradeData: Record<string, any>,
  direction: string,
): "yes" | "no" | null {
  if (tradeData.pm_side) return tradeData.pm_side;
  if (tradeData.buy_price_usd != null) {
    return direction === "short" ? "no" : "yes";
  }
  return null;
}

/** Minimal trade shape required for P&L calculation. */
export interface PnlTrade {
  author_price: number;
  direction: string;
  posted_price?: number | null;
  instrument?: string | null;
  platform?: string | null;
  pm_side?: "yes" | "no" | string | null;
}

/** Whether a trade is a Hyperliquid perpetual (eligible for leverage multiplication). */
export function isHlPerp(trade: { instrument?: string | null; platform?: string | null }): boolean {
  return trade.instrument === 'perps' || (trade.platform === 'hyperliquid' && trade.instrument !== 'polymarket');
}

/**
 * Core P&L math. Shared by both lenses.
 *
 * For Polymarket: pm_side determines the formula.
 *   YES = long-style (profit when price rises)
 *   NO  = inverted (profit when YES price drops, denominator is NO cost = 1 - base)
 *
 * For everything else: direction determines the formula.
 *   long  = profit when price rises
 *   short = profit when price falls
 */
function computePnl(currentPrice: number, basePrice: number, trade: PnlTrade): number | null {
  if (!basePrice || !currentPrice || basePrice <= 0 || currentPrice <= 0) return null;

  // Polymarket: use pm_side (explicit), fall back to direction if pm_side not set
  if (trade.instrument === "polymarket") {
    const side = trade.pm_side ?? (trade.direction === "short" ? "no" : "yes");
    if (side === "no") {
      const noCost = 1 - basePrice;
      if (noCost <= 0) return null;
      return ((basePrice - currentPrice) / noCost) * 100;
    }
    // YES = long-style
    return ((currentPrice - basePrice) / basePrice) * 100;
  }

  // Stocks / crypto / perps
  if (trade.direction === "short") {
    return ((basePrice - currentPrice) / basePrice) * 100;
  }
  return ((currentPrice - basePrice) / basePrice) * 100;
}

/**
 * Author P&L — "was this person right?"
 * Base = author_price (price when the author originally said it).
 */
export function computeAuthorPnl(currentPrice: number, trade: PnlTrade): number | null {
  return computePnl(currentPrice, trade.author_price, trade);
}

/**
 * Platform P&L — "could you have made money since it was posted?"
 * Base = posted_price (price when posted to paste.trade).
 * Returns null if posted_price is missing.
 */
export function computePostedPnl(currentPrice: number, trade: PnlTrade): number | null {
  if (!trade.posted_price) return null;
  return computePnl(currentPrice, trade.posted_price, trade);
}

/**
 * Format P&L percentage for display.
 * Examples: "+2.3%", "-0.5%", "+12.1K%" (for extreme values), "--" (for null)
 */
export function formatPnlPct(pct: number | null | undefined, precision = 1): string {
  if (pct == null || !isFinite(pct)) return "--";
  const sign = pct >= 0 ? "+" : "";
  if (Math.abs(pct) >= 10000) return `${sign}${(pct / 1000).toFixed(precision)}K%`;
  return `${sign}${pct.toFixed(precision)}%`;
}
