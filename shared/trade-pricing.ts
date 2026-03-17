/** Resolve "now" sentinel to actual ISO 8601 datetime.
 *  LLM agents pass "now" because they don't know the exact current time. */
export function resolveNowSentinel(date: string | null | undefined): string | null {
  if (date === "now") return new Date().toISOString();
  return date ?? null;
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toPositivePrice(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

export function pricesRoughlyEqual(
  left: number | null | undefined,
  right: number | null | undefined,
  tolerance = 0.01,
): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(left - right) <= tolerance;
}

export interface CanonicalTradePricingInput {
  author_price?: unknown;
  posted_price?: unknown;
}

export interface CanonicalTradePricing {
  author_price: number | null;
  posted_price: number | null;
}

/**
 * Validate and normalize trade prices.
 * Prices are cached snapshots — recomputable from ticker + timestamp.
 */
export function canonicalizeTradePricing(input: CanonicalTradePricingInput): CanonicalTradePricing {
  return {
    author_price: toPositivePrice(input.author_price),
    posted_price: toPositivePrice(input.posted_price),
  };
}
