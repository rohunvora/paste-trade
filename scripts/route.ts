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
  source_date_price?: number;
  source_date?: string;
  since_published_move_pct?: number;
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
  const filteredArgs: string[] = [];
  for (const arg of args) {
    if (arg === "--raw") {
      outputMode = "raw";
      continue;
    }
    filteredArgs.push(arg);
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

  for (let i = 2; i < filteredArgs.length; i++) {
    if (filteredArgs[i] === "--source-date" && filteredArgs[i + 1]) sourceDate = filteredArgs[++i]!;
    if (filteredArgs[i] === "--capital" && filteredArgs[i + 1]) capital = parseInt(filteredArgs[++i]!, 10);
    if (filteredArgs[i] === "--horizon" && filteredArgs[i + 1]) horizon = filteredArgs[++i]!;
    if (filteredArgs[i] === "--thesis-id" && filteredArgs[i + 1]) thesisId = filteredArgs[++i]!;
    if (filteredArgs[i] === "--subject-kind" && filteredArgs[i + 1]) {
      const parsed = filteredArgs[++i]!.toLowerCase();
      if (parsed === "asset" || parsed === "company" || parsed === "event") {
        subjectKind = parsed;
      } else {
        console.error(`Invalid --subject-kind: "${parsed}". Use asset, company, or event.`);
        process.exit(1);
      }
    }
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

interface PerpCandidate {
  full_symbol?: string;
  base_symbol?: string;
  dex?: string;
}

interface PerpInstrument {
  available?: boolean;
  hl_ticker?: string;
  publish_price?: number;
  note?: string;
  candidate_perps?: PerpCandidate[];
}

interface ShareInstrument {
  available?: boolean;
  publish_price?: number;
  note?: string;
}

interface RouteAlternative {
  platform: "hyperliquid" | "robinhood";
  instrument: "perps" | "shares";
  routed_ticker: string;
  publish_price: number | null;
}

interface RouteSummary {
  ticker: string;
  direction: Direction;
  executable: boolean;
  selected_expression: {
    platform: "hyperliquid" | "robinhood" | null;
    instrument: "perps" | "shares" | null;
    routed_ticker: string | null;
    publish_price: number | null;
  };
  alternatives: RouteAlternative[];
  price_context: {
    current_price: number;
    source_date: string | null;
    source_date_price: number | null;
    since_published_move_pct: number | null;
  };
  candidate_routes: Array<{
    routed_ticker: string;
    base_symbol: string | null;
    dex: string | null;
  }>;
  note: string | null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toPerpInstrument(value: unknown): PerpInstrument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as PerpInstrument;
}

function toShareInstrument(value: unknown): ShareInstrument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as ShareInstrument;
}

function toCandidateRoutes(perps: PerpInstrument | null): RouteSummary["candidate_routes"] {
  const candidates = Array.isArray(perps?.candidate_perps) ? perps!.candidate_perps : [];
  return candidates
    .map((candidate) => {
      const routedTicker = typeof candidate?.full_symbol === "string" ? candidate.full_symbol.trim() : "";
      if (!routedTicker) return null;
      const baseSymbol = typeof candidate?.base_symbol === "string" && candidate.base_symbol.trim()
        ? candidate.base_symbol.trim()
        : null;
      const dex = typeof candidate?.dex === "string" && candidate.dex.trim()
        ? candidate.dex.trim()
        : null;
      return { routed_ticker: routedTicker, base_symbol: baseSymbol, dex };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
}

function buildSummary(item: TickerAssessment): RouteSummary {
  const perps = toPerpInstrument(item.instruments?.perps);
  const shares = toShareInstrument(item.instruments?.shares);
  const perpsAvailable = perps?.available === true;
  const sharesAvailable = shares?.available === true;
  const canonicalPublishPrice = toFiniteNumber(item.source_date_price) ?? toFiniteNumber(item.current_price);

  let selected: RouteSummary["selected_expression"] = {
    platform: null,
    instrument: null,
    routed_ticker: null,
    publish_price: null,
  };
  const alternatives: RouteAlternative[] = [];

  if (perpsAvailable) {
    selected = {
      platform: "hyperliquid",
      instrument: "perps",
      routed_ticker: typeof perps?.hl_ticker === "string" && perps.hl_ticker.trim() ? perps.hl_ticker.trim() : item.ticker,
      publish_price: toFiniteNumber(item.source_date_price) ?? toFiniteNumber(perps?.publish_price) ?? canonicalPublishPrice,
    };
  } else if (sharesAvailable) {
    selected = {
      platform: "robinhood",
      instrument: "shares",
      routed_ticker: item.ticker,
      publish_price: toFiniteNumber(item.source_date_price) ?? toFiniteNumber(shares?.publish_price) ?? canonicalPublishPrice,
    };
  }

  if (perpsAvailable && selected.platform !== "hyperliquid") {
    alternatives.push({
      platform: "hyperliquid",
      instrument: "perps",
      routed_ticker: typeof perps?.hl_ticker === "string" && perps.hl_ticker.trim() ? perps.hl_ticker.trim() : item.ticker,
      publish_price: toFiniteNumber(item.source_date_price) ?? toFiniteNumber(perps?.publish_price) ?? canonicalPublishPrice,
    });
  }

  if (sharesAvailable && selected.platform !== "robinhood") {
    alternatives.push({
      platform: "robinhood",
      instrument: "shares",
      routed_ticker: item.ticker,
      publish_price: toFiniteNumber(item.source_date_price) ?? toFiniteNumber(shares?.publish_price) ?? canonicalPublishPrice,
    });
  }

  const noteCandidates = [perps?.note, shares?.note];
  const note = noteCandidates.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;

  return {
    ticker: item.ticker,
    direction: item.direction,
    executable: selected.platform !== null,
    selected_expression: selected,
    alternatives,
    price_context: {
      current_price: item.current_price,
      source_date: typeof item.source_date === "string" ? item.source_date : null,
      source_date_price: toFiniteNumber(item.source_date_price),
      since_published_move_pct: toFiniteNumber(item.since_published_move_pct),
    },
    candidate_routes: toCandidateRoutes(perps),
    note,
  };
}

export async function runRouteCli(argv = process.argv): Promise<void> {
  const { tickers, direction, sourceDate, capital, horizon, subjectKind, runId, outputMode, thesisId } = parseArgs(argv);

  console.error(
    `\nRoute ${tickers.join(", ")} ${direction} | $${capital.toLocaleString()} capital`
    + `${sourceDate ? ` | source: ${sourceDate}` : ""}`
    + `${horizon ? ` | horizon: ${horizon}` : ""}`
    + `${subjectKind !== "asset" ? ` | subject-kind: ${subjectKind}` : ""}`
    + "\n"
  );

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
