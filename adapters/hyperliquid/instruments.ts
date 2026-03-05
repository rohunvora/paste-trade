/**
 * Hyperliquid instrument validator.
 *
 * Validates candidate tickers against the live Hyperliquid universe
 * (default + selected HIP-3 dexes), and returns enriched metadata.
 *
 * Usage:
 *   bun run skill-dev/runtime/adapters/hyperliquid/instruments.ts "SOL,BTC,ETH"
 *   bun run skill-dev/runtime/adapters/hyperliquid/instruments.ts "SPACEX,USA500,USTECH"
 *   bun run skill-dev/runtime/adapters/hyperliquid/instruments.ts --query "defense spending"
 */

import type { InstrumentMatch, AdapterInstrumentResult } from "../../types";
import {
  buildHlUniverse,
  resolveTicker,
  searchInstruments,
  summarizeUniverseDegradation,
  type HlResolution,
} from "./universe";

const API = "https://api.hyperliquid.xyz/info";

interface TrailingPerformance {
  "1M"?: number;
  "3M"?: number;
  "6M"?: number;
  "1Y"?: number;
}

interface ValidatedPerp extends InstrumentMatch {
  mark_price: number;
  funding_rate_hourly: number;
  funding_rate_annualized_pct: number;
  open_interest_usd: number;
  volume_24h_usd: number;
  max_leverage: number;
  liquidity: "high" | "medium" | "low";
  trailing_performance?: TrailingPerformance;

  // Additive metadata
  full_symbol: string;
  base_symbol: string;
  dex: string;
  dex_full_name: string;
  asset_class: string;
  theme_tags: string[];
  instrument_description?: string;
  pricing_note?: string;
  source_warnings?: string[];
  oi_cap_usd?: number;
  funding_multiplier?: number;
  funding_interest_rate?: number;
  match_kind: "exact" | "prefixed" | "alias" | "query";
  selection_reason: string;
  confidence: number;
  execution_source: "hyperliquid_api";
}

type CompactValidatedPerp = Pick<
  ValidatedPerp,
  | "ticker"
  | "name"
  | "relevance"
  | "why"
  | "mark_price"
  | "funding_rate_annualized_pct"
  | "max_leverage"
  | "liquidity"
  | "full_symbol"
  | "base_symbol"
  | "dex"
  | "match_kind"
  | "selection_reason"
  | "confidence"
  | "execution_source"
>;

interface ResolverDiagnosticsOutput {
  degraded: boolean;
  failed_dexes?: Array<{ dex: string; reason: string }>;
  warnings?: string[];
}

function relevanceFromMatchKind(kind: HlResolution["match_kind"]): InstrumentMatch["relevance"] {
  if (kind === "exact" || kind === "alias") return "direct";
  if (kind === "prefixed") return "proxy";
  return "lateral";
}

function toValidatedPerp(resolution: HlResolution): ValidatedPerp {
  const inst = resolution.instrument;
  const markPrice = inst.mark_price ?? inst.oracle_price ?? 0;
  const funding = inst.funding_rate_hourly ?? 0;
  const volume = inst.volume_24h_usd ?? 0;
  const oiUsd = inst.open_interest_usd ?? 0;
  const maxLeverage = inst.max_leverage ?? 1;
  const liquidity = inst.liquidity ?? "low";
  const displayTicker = inst.full_symbol;
  const dexLabel = inst.dex === "default" ? "" : ` [${inst.dex}]`;
  const priceStr = markPrice >= 1 ? markPrice.toFixed(2) : markPrice.toFixed(6);

  return {
    ticker: `${displayTicker}-PERP`,
    name: `${displayTicker} Perpetual (${maxLeverage}x max, ${liquidity} liq)${dexLabel}`,
    relevance: relevanceFromMatchKind(resolution.match_kind),
    why: `$${priceStr}, ${liquidity} liquidity, up to ${maxLeverage}x leverage${dexLabel}`,
    mark_price: markPrice,
    funding_rate_hourly: funding,
    funding_rate_annualized_pct: inst.funding_rate_annualized_pct ?? 0,
    open_interest_usd: Math.round(oiUsd),
    volume_24h_usd: Math.round(volume),
    max_leverage: maxLeverage,
    liquidity,
    full_symbol: inst.full_symbol,
    base_symbol: inst.base_symbol,
    dex: inst.dex,
    dex_full_name: inst.dex_full_name,
    asset_class: inst.asset_class,
    theme_tags: inst.theme_tags,
    instrument_description: inst.instrument_description,
    pricing_note: inst.pricing_note,
    source_warnings: inst.source_warnings,
    oi_cap_usd: inst.oi_cap_usd,
    funding_multiplier: inst.funding_multiplier,
    funding_interest_rate: inst.funding_interest_rate,
    match_kind: resolution.match_kind,
    selection_reason: resolution.selection_reason,
    confidence: Math.round(resolution.confidence * 1000) / 1000,
    execution_source: "hyperliquid_api",
  };
}

function toCompactValidatedPerp(perp: ValidatedPerp): CompactValidatedPerp {
  return {
    ticker: perp.ticker,
    name: perp.name,
    relevance: perp.relevance,
    why: perp.why,
    mark_price: perp.mark_price,
    funding_rate_annualized_pct: perp.funding_rate_annualized_pct,
    max_leverage: perp.max_leverage,
    liquidity: perp.liquidity,
    full_symbol: perp.full_symbol,
    base_symbol: perp.base_symbol,
    dex: perp.dex,
    match_kind: perp.match_kind,
    selection_reason: perp.selection_reason,
    confidence: perp.confidence,
    execution_source: perp.execution_source,
  };
}

async function fetchTrailingPerformance(
  coin: string,
  currentPrice: number
): Promise<TrailingPerformance> {
  if (!currentPrice || currentPrice <= 0) return {};

  try {
    const nowMs = Date.now();
    const oneYearAgoMs = nowMs - 366 * 86400 * 1000;

    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: { coin, interval: "1d", startTime: oneYearAgoMs, endTime: nowMs },
      }),
    });
    if (!res.ok) return {};

    const candles = (await res.json()) as Array<{ t: number; c: string }>;
    if (!candles?.length) return {};

    const targets: Record<string, number> = {
      "1M": nowMs - 30 * 86400 * 1000,
      "3M": nowMs - 90 * 86400 * 1000,
      "6M": nowMs - 180 * 86400 * 1000,
      "1Y": nowMs - 365 * 86400 * 1000,
    };
    const performance: TrailingPerformance = {};

    for (const [label, targetMs] of Object.entries(targets)) {
      let bestIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < candles.length; i++) {
        const diff = Math.abs((candles[i]?.t ?? 0) - targetMs);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      const historicalClose = parseFloat(candles[bestIdx]?.c ?? "0");
      if (historicalClose > 0) {
        const pct = Math.round(((currentPrice / historicalClose) - 1) * 1000) / 10;
        (performance as Record<string, number>)[label] = pct;
      }
    }

    return performance;
  } catch {
    return {};
  }
}

function parseArgs():
  | { mode: "query"; query: string; compact: boolean }
  | { mode: "tickers"; tickers: string[]; compact: boolean } {
  const rawArgs = process.argv.slice(2);
  const args: string[] = [];
  let compact = false;

  for (const arg of rawArgs) {
    if (arg === "--compact") {
      compact = true;
      continue;
    }
    args.push(arg);
  }

  if (!args.length) {
    console.error('Usage: bun run skill-dev/runtime/adapters/hyperliquid/instruments.ts "SOL,BTC,ETH"');
    console.error('       bun run skill-dev/runtime/adapters/hyperliquid/instruments.ts --query "defense spending"');
    console.error("       Add --compact to reduce output payload size.");
    process.exit(1);
  }

  if (args[0] === "--query") {
    const query = args.slice(1).join(" ").trim();
    if (!query) {
      console.error('Usage: bun run skill-dev/runtime/adapters/hyperliquid/instruments.ts --query "defense spending"');
      process.exit(1);
    }
    return { mode: "query", query, compact };
  }

  const raw = args.join(" ");
  const tickers = raw
    .split(/[,\s]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  if (!tickers.length) {
    console.error("No tickers provided.");
    process.exit(1);
  }
  return { mode: "tickers", tickers, compact };
}

async function main() {
  const parsed = parseArgs();
  const universe = await buildHlUniverse();
  const degradation = summarizeUniverseDegradation(universe);

  console.error(
    `Live perps: ${universe.dex_summaries.map((d) => `${d.dex}=${d.assets}`).join(", ")}`
  );
  if (degradation) {
    console.error(`WARNING: ${degradation}`);
  }

  const resolutions: HlResolution[] = [];
  let skipped = 0;

  if (parsed.mode === "query") {
    console.error(`\nQuerying Hyperliquid universe for: "${parsed.query}"\n`);
    resolutions.push(...searchInstruments(universe, parsed.query, 5));
  } else {
    console.error(`\nValidating ${parsed.tickers.length} tickers against Hyperliquid universe...\n`);
    for (const rawTicker of parsed.tickers) {
      const resolution = resolveTicker(rawTicker, universe, { allow_prefix_match: true });
      if (!resolution) {
        console.error(`  SKIP: ${rawTicker} -- not listed on enabled Hyperliquid dex universe`);
        skipped++;
        continue;
      }
      if (resolution.instrument.base_symbol !== rawTicker.replace(/-PERP$/i, "")) {
        console.error(`  ${rawTicker} -> ${resolution.instrument.full_symbol} (${resolution.match_kind})`);
      }
      resolutions.push(resolution);
    }
  }

  const validated = resolutions.map(toValidatedPerp);

  if (!parsed.compact) {
    console.error(`Fetching trailing performance for ${validated.length} perp(s)...`);
    await Promise.all(
      validated.map(async (v) => {
        v.trailing_performance = await fetchTrailingPerformance(v.full_symbol, v.mark_price);
      })
    );
  } else {
    console.error(`Skipping trailing performance fetch (--compact) for ${validated.length} perp(s)...`);
  }

  if (parsed.mode === "tickers") {
    console.error(`\nValidated: ${validated.length}/${parsed.tickers.length} (${skipped} skipped)\n`);
  } else {
    console.error(`\nQuery candidates: ${validated.length}\n`);
  }

  const instruments: InstrumentMatch[] = validated.map((v) => ({
    ticker: v.ticker,
    name: v.name,
    relevance: v.relevance,
    why: v.why,
  }));

  const result: AdapterInstrumentResult & {
    validated_instruments: Array<ValidatedPerp | CompactValidatedPerp>;
    resolver_diagnostics?: ResolverDiagnosticsOutput;
  } = {
    platform: "hyperliquid",
    instruments,
    search_method: parsed.mode === "query" ? "query" : "claude_proposed",
    validated_instruments: parsed.compact ? validated.map(toCompactValidatedPerp) : validated,
  };
  if (universe.diagnostics.degraded) {
    result.resolver_diagnostics = {
      degraded: true,
      failed_dexes: universe.diagnostics.failed_dexes,
      warnings: universe.diagnostics.warnings,
    };
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
