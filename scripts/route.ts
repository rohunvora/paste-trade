#!/usr/bin/env bun
/**
 * Backend-only route adapter.
 *
 * Delegates all market routing/pricing logic to paste.trade Worker endpoint:
 *   POST /api/skill/route
 *
 * This adapter intentionally does not call Yahoo/Hyperliquid directly.
 */

import { applyRunId, extractRunIdArg } from "./run-id";
import { ensureKey, getBaseUrl, loadKey } from "./ensure-key";
import { toFiniteNumber, resolveNowSentinel } from "../shared/trade-pricing";
import {
  type CandidateRoute,
  type RoutingMetadata,
  EMPTY_ROUTING_METADATA,
  extractPerpMetadata,
  toCandidateRoutes,
  toPerpInstrument,
  toShareInstrument,
} from "../adapters/route-fields";

const DEFAULT_CAPITAL = 100_000;
const REQUEST_TIMEOUT_MS = Number(process.env.ASSESS_BACKEND_TIMEOUT_MS || 45_000);

type Direction = "long" | "short";
type SubjectKind = "asset" | "company" | "event";

interface BackendErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    retry_after?: number;
  };
}

interface TickerAssessment {
  ticker: string;
  direction: Direction;
  capital: number;
  current_price: number;
  author_price?: number;
  source_date?: string;
  earnings?: { date: string; days_away: number };
  trailing_perf?: Record<string, number>;
  company_name?: string;
  sector?: string | null;
  market_cap_fmt?: string;
  business_summary?: string;
  instruments: {
    perps?: Record<string, unknown>;
    shares?: Record<string, unknown>;
    polymarket?: Record<string, unknown>;
  };
}

interface BackendAssessResponse {
  contract_version: string;
  results: TickerAssessment[];
  diagnostics?: {
    warnings?: string[];
    failed_tickers?: Array<{ ticker: string; code: string; message: string }>;
    run_id?: string;
    request_id?: string;
  };
}

type OutputMode = "summary" | "raw";

function parseArgs(argv: string[]) {
  const { runId, args } = extractRunIdArg(argv);
  applyRunId(runId);

  let outputMode: OutputMode = "summary";
  // Separate positional args from named flags so flags can appear before positionals
  const knownFlags = new Set(["--source-date", "--capital", "--horizon", "--thesis-id", "--subject-kind"]);
  const filteredArgs: string[] = [];
  for (let j = 0; j < args.length; j++) {
    if (args[j] === "--raw") {
      outputMode = "raw";
      continue;
    }
    if (knownFlags.has(args[j]!) && j + 1 < args.length) {
      j++; // skip the flag and its value — parsed later from `args`
      continue;
    }
    filteredArgs.push(args[j]!);
  }

  if (filteredArgs.length < 2) {
    console.error("Usage: bun run skill/scripts/route.ts [--run-id <runId>] <TICKER[,TICKER]> <long|short> [options]");
    console.error("Options:");
    console.error("  --source-date YYYY-MM-DD   Price at source date for since-published P&L");
    console.error("  --capital NUMBER           Capital (default: 100000)");
    console.error('  --horizon TEXT             Author\'s timing (e.g., "Q3 2026", "by 2028")');
    console.error("  --subject-kind KIND        asset | company | event (default: asset)");
    console.error("  --raw                      Print backend payload without route summary shaping");
    process.exit(1);
  }

  const tickers = filteredArgs[0]!
    .split(/[,\s]+/)
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);

  const direction = filteredArgs[1]!.toLowerCase() as Direction;
  if (direction !== "long" && direction !== "short") {
    console.error(`Invalid direction: "${direction}". Use "long" or "short".`);
    process.exit(1);
  }

  let sourceDate: string | null = null;
  let capital = DEFAULT_CAPITAL;
  let horizon: string | null = null;
  let subjectKind: SubjectKind = "asset";
  let thesisId: string | null = null;

  // Parse named flags from the original args (positional args already extracted above)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source-date" && args[i + 1]) sourceDate = args[++i]!;
    if (args[i] === "--capital" && args[i + 1]) capital = parseInt(args[++i]!, 10);
    if (args[i] === "--horizon" && args[i + 1]) horizon = args[++i]!;
    if (args[i] === "--thesis-id" && args[i + 1]) thesisId = args[++i]!;
    if (args[i] === "--subject-kind" && args[i + 1]) {
      const parsed = args[++i]!.toLowerCase();
      if (parsed === "asset" || parsed === "company" || parsed === "event") {
        subjectKind = parsed;
      } else {
        console.error(`Invalid --subject-kind: "${parsed}". Use asset, company, or event.`);
        process.exit(1);
      }
    }
  }

  const resolvedDate = resolveNowSentinel(sourceDate);
  if (resolvedDate !== sourceDate) {
    sourceDate = resolvedDate;
    console.error(`[route] Resolved --source-date "now" → ${sourceDate}`);
  }

  return { tickers, direction, sourceDate, capital, horizon, subjectKind, runId, outputMode, thesisId };
}

async function getRouteAuth(): Promise<{ baseUrl: string; apiKey: string }> {
  const baseUrl = getBaseUrl();
  const existingKey = loadKey("PASTE_TRADE_KEY") || process.env.PASTE_TRADE_API_KEY?.trim();
  if (existingKey) {
    return { baseUrl, apiKey: existingKey };
  }

  const apiKey = await ensureKey();
  if (!apiKey) {
    throw new Error("PASTE_TRADE_KEY (or PASTE_TRADE_API_KEY) is required for route adapter.");
  }

  return { baseUrl, apiKey };
}

function assertBackendResponse(payload: unknown): asserts payload is BackendAssessResponse {
  if (!payload || typeof payload !== "object") {
    throw new Error("Malformed backend route response: expected JSON object.");
  }
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.results)) {
    throw new Error("Malformed backend route response: missing results array.");
  }
  if (typeof record.contract_version !== "string") {
    throw new Error("Malformed backend route response: missing contract_version.");
  }
}

async function callBackendRoute(
  tickers: string[],
  direction: Direction,
  capital: number,
  sourceDate: string | null,
  horizon: string | null,
  subjectKind: SubjectKind,
  runId?: string | null,
): Promise<BackendAssessResponse> {
  const { baseUrl, apiKey } = await getRouteAuth();

  const response = await fetch(`${baseUrl}/api/skill/route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      tickers,
      direction,
      capital,
      source_date: sourceDate ?? undefined,
      horizon: horizon ?? undefined,
      subject_kind: subjectKind,
      run_id: runId ?? undefined,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    let message = `Backend route failed (${response.status})`;
    try {
      const errPayload = await response.json() as BackendErrorEnvelope;
      if (errPayload?.error?.message) {
        message = `${message}: ${errPayload.error.message}`;
      }
      if (errPayload?.error?.retry_after != null) {
        message = `${message} (retry_after=${errPayload.error.retry_after}s)`;
      }
    } catch {
      const text = await response.text().catch(() => "");
      if (text) message = `${message}: ${text}`;
    }
    throw new Error(message);
  }

  const payload = await response.json();
  assertBackendResponse(payload);
  return payload;
}

async function pushStatusEvent(sourceId: string, runId: string | null | undefined, message: string): Promise<void> {
  try {
    const { pushEvent } = await import("./stream-context");
    await pushEvent(sourceId, "status", { message }, { runId: runId ?? undefined });
  } catch {
    // streaming is optional
  }
}

interface RouteAlternative {
  platform: "hyperliquid" | "robinhood" | "polymarket";
  instrument: "perps" | "shares" | "polymarket";
  routed_ticker: string;
  author_price: number | null;
}

interface RouteSummary {
  ticker: string;
  direction: Direction;
  executable: boolean;
  selected_expression: {
    platform: "hyperliquid" | "robinhood" | "polymarket" | null;
    instrument: "perps" | "shares" | "polymarket" | null;
    routed_ticker: string | null;
    author_price: number | null;
  } & RoutingMetadata;
  alternatives: RouteAlternative[];
  prediction_markets?: {
    platform: "polymarket";
    markets: Array<{
      market_question: string;
      market_slug: string;
      condition_id: string | null;
      buy_price_usd: number;  // raw from assess API (mapped to pm_yes_no_price in output)
      no_price: number;
      volume_usd: number;    // raw from assess API (not stored on trades)
      end_date: string | null;
    }>;
  };
  price_context: {
    current_price: number;
    source_date: string | null;
    author_price: number | null;
  };
  candidate_routes: CandidateRoute[];
  note: string | null;
}

function buildSummary(item: TickerAssessment): RouteSummary {
  const perps = toPerpInstrument(item.instruments?.perps);
  const shares = toShareInstrument(item.instruments?.shares);
  const perpsAvailable = perps?.available === true;
  const sharesAvailable = shares?.available === true;
  const canonicalAuthorPrice = toFiniteNumber(item.author_price) ?? toFiniteNumber(item.current_price);

  let selected: RouteSummary["selected_expression"] = {
    platform: null,
    instrument: null,
    routed_ticker: null,
    author_price: null,
    ...EMPTY_ROUTING_METADATA,
  };
  const alternatives: RouteAlternative[] = [];

  if (perpsAvailable) {
    const routedTicker = typeof perps?.hl_ticker === "string" && perps.hl_ticker.trim() ? perps.hl_ticker.trim() : item.ticker;
    // For alias matches (GLD→GOLD), the perp author_price is in perp units ($5,094)
    // while item.author_price is in ETF units ($468). Prefer the perp's own price.
    const perpAuthorPrice = toFiniteNumber(perps?.author_price);
    selected = {
      platform: "hyperliquid",
      instrument: "perps",
      routed_ticker: routedTicker,
      author_price: perpAuthorPrice ?? toFiniteNumber(item.author_price) ?? canonicalAuthorPrice,
      ...extractPerpMetadata(perps, routedTicker),
    };
  } else if (sharesAvailable) {
    selected = {
      platform: "robinhood",
      instrument: "shares",
      routed_ticker: item.ticker,
      author_price: toFiniteNumber(item.author_price) ?? toFiniteNumber(shares?.author_price) ?? canonicalAuthorPrice,
      ...EMPTY_ROUTING_METADATA,
    };
  }

  if (perpsAvailable && selected.platform !== "hyperliquid") {
    alternatives.push({
      platform: "hyperliquid",
      instrument: "perps",
      routed_ticker: typeof perps?.hl_ticker === "string" && perps.hl_ticker.trim() ? perps.hl_ticker.trim() : item.ticker,
      author_price: toFiniteNumber(item.author_price) ?? toFiniteNumber(perps?.author_price) ?? canonicalAuthorPrice,
    });
  }

  if (sharesAvailable && selected.platform !== "robinhood") {
    alternatives.push({
      platform: "robinhood",
      instrument: "shares",
      routed_ticker: item.ticker,
      author_price: toFiniteNumber(item.author_price) ?? toFiniteNumber(shares?.author_price) ?? canonicalAuthorPrice,
    });
  }

  // Polymarket markets
  const pm = item.instruments?.polymarket as
    | { available?: boolean; markets?: Array<Record<string, unknown>> }
    | undefined;
  let predictionMarkets: RouteSummary["prediction_markets"];
  if (pm?.available && Array.isArray(pm.markets) && pm.markets.length) {
    predictionMarkets = {
      platform: "polymarket",
      markets: pm.markets.map((m: any) => ({
        market_question: m.question,
        market_slug: m.slug,
        condition_id: m.condition_id ?? null,
        pm_yes_no_price: m.outcome_prices?.yes ?? 0,
        no_price: m.outcome_prices?.no ?? 0,
        volume_usd: m.volume_usd ?? 0,
        end_date: m.end_date ?? null,
      })),
    };
  }

  const noteCandidates = [perps?.note, shares?.note];
  const note = noteCandidates.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;

  return {
    ticker: item.ticker,
    direction: item.direction,
    executable: selected.platform !== null,
    selected_expression: selected,
    alternatives,
    ...(predictionMarkets ? { prediction_markets: predictionMarkets } : {}),
    price_context: {
      current_price: item.current_price,
      source_date: typeof item.source_date === "string" ? item.source_date : null,
      author_price: toFiniteNumber(item.author_price),
    },
    candidate_routes: toCandidateRoutes(perps),
    note,
  };
}

export async function runRouteCli(argv = process.argv): Promise<void> {
  const { tickers, direction, sourceDate, capital, horizon, subjectKind, runId, outputMode, thesisId } = parseArgs(argv);

  const { streamLog } = await import("./stream-log");
  const logOpts = thesisId ? { thesisId } : undefined;
  streamLog(`Routing ${tickers.join(", ")} ${direction}...`, logOpts);

  let streamCtx: { source_id: string } | null = null;
  try {
    const { getStreamContext, pushEvent } = await import("./stream-context");
    streamCtx = getStreamContext(runId);
    if (streamCtx) {
      if (thesisId) {
        // Emit thesis_routing event with thesis identity and candidate tickers
        await pushEvent(streamCtx.source_id, "thesis_routing", {
          thesis_id: thesisId,
          candidates: tickers,
        }, { runId: runId ?? undefined });
      } else {
        await pushStatusEvent(streamCtx.source_id, runId, `Pricing ${tickers.join(", ")}...`);
      }
    }
  } catch {
    // streaming is optional
  }

  const backend = await callBackendRoute(
    tickers,
    direction,
    capital,
    sourceDate,
    horizon,
    subjectKind,
    runId,
  );

  const warnings = backend.diagnostics?.warnings ?? [];
  if (warnings.length > 0) {
    console.error(`Backend warnings: ${warnings.join(" | ")}`);
  }

  if (streamCtx) {
    for (const item of backend.results) {
      await pushStatusEvent(
        streamCtx.source_id,
        runId,
        `${item.ticker} at $${Number(item.current_price).toLocaleString()}`,
      );
    }
  }

  if (outputMode === "raw") {
    console.log(JSON.stringify(
      backend.results.length === 1 ? backend.results[0] : backend.results,
      null,
      2,
    ));
    return;
  }

  const summaries = backend.results.map((item) => buildSummary(item));
  const payload = {
    tool: "route",
    route: summaries.length === 1 ? summaries[0] : summaries,
    diagnostics: {
      warnings: backend.diagnostics?.warnings ?? [],
      failed_tickers: backend.diagnostics?.failed_tickers ?? [],
      run_id: backend.diagnostics?.run_id ?? null,
      request_id: backend.diagnostics?.request_id ?? null,
    },
  };
  console.log(JSON.stringify(payload, null, 2));
}

if (import.meta.main) {
  runRouteCli().catch((error) => {
    console.error("Fatal:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
