/**
 * Board API POST
 *
 * Wraps the HTTP POST so BOARD_URL from .env is available.
 * Accepts JSON payload as CLI argument or via stdin (for large payloads
 * that break shell quoting).
 *
 * Usage:
 *   bun run skill-dev/skill-v2-lab/scripts/post.ts '<JSON payload>'
 *   echo '<JSON>' | bun run skill-dev/skill-v2-lab/scripts/post.ts
 */

import { applyRunId, extractRunIdArg } from "./run-id";
import { appendTraceEvent, hashForTrace } from "./trace-audit";
import { existsSync } from "fs";

const { runId, args } = extractRunIdArg(process.argv);
applyRunId(runId);

let payload = args[0];
if (!payload) {
  // Read from stdin if no CLI arg
  payload = await Bun.stdin.text();
}
if (!payload?.trim()) {
  console.error("Usage: bun run skill-dev/skill-v2-lab/scripts/post.ts '<JSON payload>' (or pipe via stdin)");
  process.exit(1);
}
payload = payload.trim();

// Validate JSON before sending
let body: any;
try {
  body = JSON.parse(payload);
} catch {
  console.error(`[board] Invalid JSON payload: ${payload.slice(0, 200)}`);
  process.exit(1);
}

interface SavedExtractionRecord {
  id?: string;
  run_id?: string;
  thesis?: unknown;
  source_date?: unknown;
  headline?: string;
  quotes?: unknown;
  route_status?: string;
  routed?: boolean;
  who?: unknown;
  route_evidence?: unknown;
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeTicker(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeIsoDateTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeRouteStatus(value: SavedExtractionRecord): "routed" | "unrouted" | null {
  const raw = typeof value.route_status === "string" ? value.route_status.trim().toLowerCase() : "";
  if (raw === "routed" || raw === "unrouted") return raw;
  if (typeof value.routed === "boolean") return value.routed ? "routed" : "unrouted";
  return null;
}

const FALLBACK_REASON_TAGS = new Set([
  "direct_unavailable",
  "direct_unpriceable",
  "direct_mismatch",
  "direct_weaker_fit",
]);

async function loadExtractionById(runIdValue: string, thesisId: string): Promise<SavedExtractionRecord | null> {
  const extractionDir = new URL("../data/extractions", import.meta.url).pathname;
  if (!existsSync(extractionDir)) return null;
  const files = (await Array.fromAsync(new Bun.Glob("extraction-*.jsonl").scan(extractionDir)))
    .map((file) => `${extractionDir}/${file}`)
    .sort()
    .reverse();

  for (const file of files) {
    const content = await Bun.file(file).text();
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as SavedExtractionRecord;
        if (parsed.run_id === runIdValue && parsed.id === thesisId) {
          return parsed;
        }
      } catch {
        // Ignore malformed lines.
      }
    }
  }
  return null;
}

function getSelectedExpression(record: SavedExtractionRecord): Record<string, unknown> | null {
  const routeEvidence =
    record.route_evidence && typeof record.route_evidence === "object" && !Array.isArray(record.route_evidence)
      ? record.route_evidence as Record<string, unknown>
      : null;
  if (!routeEvidence) return null;
  const selected =
    routeEvidence.selected_expression
    && typeof routeEvidence.selected_expression === "object"
    && !Array.isArray(routeEvidence.selected_expression)
      ? routeEvidence.selected_expression as Record<string, unknown>
      : null;
  return selected;
}

function getDirectChecks(record: SavedExtractionRecord): Array<Record<string, unknown>> {
  const routeEvidence =
    record.route_evidence && typeof record.route_evidence === "object" && !Array.isArray(record.route_evidence)
      ? record.route_evidence as Record<string, unknown>
      : null;
  if (!routeEvidence || !Array.isArray(routeEvidence.direct_checks)) return [];
  return routeEvidence.direct_checks
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
}

function resolveDirectCheckForTicker(
  record: SavedExtractionRecord,
  ticker: string,
): Record<string, unknown> | null {
  const checks = getDirectChecks(record);
  const target = normalizeTicker(ticker);
  if (!target) return null;
  for (const check of checks) {
    if (normalizeTicker(check.ticker_tested) === target) return check;
  }
  return checks[0] ?? null;
}

function hydratePayloadFromSavedExtraction(
  tradeBody: Record<string, unknown>,
  extracted: SavedExtractionRecord | null,
): void {
  if (!extracted) return;

  const selected = getSelectedExpression(extracted);
  const selectedTicker = normalizeTicker(selected?.ticker);
  const selectedDirection = typeof selected?.direction === "string" ? selected.direction.trim().toLowerCase() : "";
  const selectedPlatform = typeof selected?.platform === "string" ? selected.platform.trim().toLowerCase() : "";
  const selectedInstrument = typeof selected?.instrument === "string" ? selected.instrument.trim().toLowerCase() : "";
  const selectedTradeType = typeof selected?.trade_type === "string" ? selected.trade_type.trim().toLowerCase() : "";

  if (!normalizeTicker(tradeBody.ticker) && selectedTicker) tradeBody.ticker = selectedTicker;
  if (typeof tradeBody.direction !== "string" && (selectedDirection === "long" || selectedDirection === "short")) {
    tradeBody.direction = selectedDirection;
  }
  if (typeof tradeBody.platform !== "string" && selectedPlatform) tradeBody.platform = selectedPlatform;
  if (typeof tradeBody.instrument !== "string" && selectedInstrument) tradeBody.instrument = selectedInstrument;
  if (typeof tradeBody.trade_type !== "string" && selectedTradeType) tradeBody.trade_type = selectedTradeType;
  if (typeof tradeBody.thesis !== "string" && typeof extracted.thesis === "string" && extracted.thesis.trim()) {
    tradeBody.thesis = extracted.thesis.trim();
  }

  const normalizedSourceDate = normalizeIsoDateTime(tradeBody.source_date)
    ?? normalizeIsoDateTime(extracted.source_date);
  if (normalizedSourceDate) tradeBody.source_date = normalizedSourceDate;

  if (typeof tradeBody.headline_quote !== "string" || !tradeBody.headline_quote.trim()) {
    if (typeof extracted.headline === "string" && extracted.headline.trim()) {
      tradeBody.headline_quote = extracted.headline.trim();
    } else if (Array.isArray(extracted.quotes)) {
      const firstQuote = extracted.quotes.find((q) => typeof q === "string" && q.trim());
      if (typeof firstQuote === "string" && firstQuote.trim()) {
        tradeBody.headline_quote = firstQuote.trim();
      }
    }
  }

  const check = resolveDirectCheckForTicker(extracted, normalizeTicker(tradeBody.ticker));
  const selectedEntryPrice = toFiniteNumber(selected?.entry_price);
  const checkEntryPrice = toFiniteNumber(check?.entry_price);
  if (toFiniteNumber(tradeBody.entry_price) == null) {
    const candidateEntry = selectedEntryPrice ?? checkEntryPrice;
    if (candidateEntry != null && candidateEntry > 0) tradeBody.entry_price = candidateEntry;
  }

  const selectedSourceDatePrice = toFiniteNumber(selected?.source_date_price);
  const checkSourceDatePrice = toFiniteNumber(check?.source_date_price);
  if (toFiniteNumber(tradeBody.source_date_price) == null) {
    const candidateSource = selectedSourceDatePrice ?? checkSourceDatePrice;
    if (candidateSource != null && candidateSource > 0) tradeBody.source_date_price = candidateSource;
  }

  const selectedSince = toFiniteNumber(selected?.since_published_move_pct);
  const checkSince = toFiniteNumber(check?.since_published_move_pct);
  if (toFiniteNumber(tradeBody.since_published_move_pct) == null) {
    const candidateSince = selectedSince ?? checkSince;
    if (candidateSince != null) tradeBody.since_published_move_pct = candidateSince;
  }
}

interface BackendAssessMinimal {
  results?: Array<{
    source_date_price?: number;
    since_published_move_pct?: number;
  }>;
}

async function enrichBaselineViaAssess(
  tradeBody: Record<string, unknown>,
  baseUrl: string,
  apiKey: string,
): Promise<void> {
  const ticker = normalizeTicker(tradeBody.ticker);
  const sourceDate = normalizeIsoDateTime(tradeBody.source_date);
  if (!ticker || !sourceDate) return;
  tradeBody.source_date = sourceDate;

  const hasSourceDatePrice = toFiniteNumber(tradeBody.source_date_price) != null;
  const hasSincePublishedMove = toFiniteNumber(tradeBody.since_published_move_pct) != null;
  if (hasSourceDatePrice && hasSincePublishedMove) return;

  const direction = (typeof tradeBody.direction === "string" && tradeBody.direction.toLowerCase() === "short")
    ? "short"
    : "long";

  try {
    const response = await fetch(`${baseUrl}/api/skill/assess`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        tickers: [ticker],
        direction,
        capital: 100_000,
        source_date: sourceDate,
        subject_kind: "asset",
        run_id: runId ?? undefined,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`[board] baseline assess failed (${response.status})${errText ? `: ${errText}` : ""}`);
      return;
    }

    const parsed = await response.json() as BackendAssessMinimal;
    const row = Array.isArray(parsed.results) ? parsed.results[0] : null;
    if (!row) return;

    const sourceDatePrice = toFiniteNumber(row.source_date_price);
    const sincePublished = toFiniteNumber(row.since_published_move_pct);
    if (!hasSourceDatePrice && sourceDatePrice != null && sourceDatePrice > 0) {
      tradeBody.source_date_price = sourceDatePrice;
    }
    if (!hasSincePublishedMove && sincePublished != null) {
      tradeBody.since_published_move_pct = sincePublished;
    }
  } catch (error) {
    console.error(`[board] baseline assess error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validatePayloadAgainstSavedExtraction(
  runIdValue: string | null,
  tradeBody: Record<string, unknown>,
): Promise<void> {
  if (!runIdValue) return;
  const thesisId = typeof tradeBody.thesis_id === "string" ? tradeBody.thesis_id.trim() : "";
  if (!thesisId) return;

  const extracted = await loadExtractionById(runIdValue, thesisId);
  if (!extracted) return;

  const extractedRouteStatus = normalizeRouteStatus(extracted);
  if (extractedRouteStatus === "routed") {
    if (!extracted.route_evidence || typeof extracted.route_evidence !== "object" || Array.isArray(extracted.route_evidence)) {
      console.error(
        `[board] routed thesis ${thesisId} is missing route_evidence. Refusing POST.`,
      );
      process.exit(1);
    }

    const routeEvidence = extracted.route_evidence as Record<string, unknown>;
    const selectedExpression =
      routeEvidence.selected_expression &&
      typeof routeEvidence.selected_expression === "object" &&
      !Array.isArray(routeEvidence.selected_expression)
        ? (routeEvidence.selected_expression as Record<string, unknown>)
        : null;
    if (!selectedExpression) {
      console.error(
        `[board] routed thesis ${thesisId} is missing route_evidence.selected_expression. Refusing POST.`,
      );
      process.exit(1);
    }

    const selectedTicker = normalizeTicker(selectedExpression.ticker);
    const postedTicker = normalizeTicker(tradeBody.ticker);
    if (selectedTicker && postedTicker && selectedTicker !== postedTicker) {
      console.error(
        `[board] posted ticker ${postedTicker} does not match selected_expression ticker ${selectedTicker} for thesis ${thesisId}. Refusing POST.`,
      );
      process.exit(1);
    }

    for (const field of ["direction", "instrument", "platform", "trade_type"] as const) {
      const selectedValue = typeof selectedExpression[field] === "string" ? selectedExpression[field]!.trim().toLowerCase() : "";
      const postedValue = typeof tradeBody[field] === "string" ? String(tradeBody[field]).trim().toLowerCase() : "";
      if (selectedValue && postedValue && selectedValue !== postedValue) {
        console.error(
          `[board] posted ${field}=${postedValue} does not match selected_expression ${field}=${selectedValue} for thesis ${thesisId}. Refusing POST.`,
        );
        process.exit(1);
      }
    }

    const directChecks = Array.isArray(routeEvidence.direct_checks) ? routeEvidence.direct_checks : [];
    const directTickers = new Set<string>();
    const executableDirectTickers = new Set<string>();
    for (const check of directChecks) {
      if (!check || typeof check !== "object" || Array.isArray(check)) continue;
      const record = check as Record<string, unknown>;
      const ticker = normalizeTicker(record.ticker_tested);
      if (!ticker) continue;
      directTickers.add(ticker);
      if (record.executable === true) executableDirectTickers.add(ticker);
    }

    const selectedIsProxy = !!(selectedTicker && !directTickers.has(selectedTicker));
    const fallbackTag = typeof routeEvidence.fallback_reason_tag === "string" ? routeEvidence.fallback_reason_tag.trim() : "";

    if (selectedIsProxy) {
      if (!fallbackTag || !FALLBACK_REASON_TAGS.has(fallbackTag)) {
        console.error(
          `[board] proxy route for thesis ${thesisId} is missing valid fallback_reason_tag. Refusing POST.`,
        );
        process.exit(1);
      }
      if (executableDirectTickers.size > 0 && fallbackTag !== "direct_weaker_fit") {
        console.error(
          `[board] proxy route for thesis ${thesisId} has executable direct checks and must use fallback_reason_tag=direct_weaker_fit. Refusing POST.`,
        );
        process.exit(1);
      }
    }
  }

  const extractedQuotes = Array.isArray(extracted.quotes)
    ? extracted.quotes
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
    : [];
  const extractedQuoteSet = new Set(extractedQuotes);

  if (extractedQuoteSet.size > 0) {
    const headlineQuote = normalizeText(tradeBody.headline_quote);
    if (headlineQuote && !extractedQuoteSet.has(headlineQuote)) {
      console.error(
        `[board] headline_quote must match the thesis quotes saved in extraction ${thesisId}. Refusing POST.`,
      );
      process.exit(1);
    }

    const segments = (tradeBody.derivation as { segments?: unknown } | undefined)?.segments;
    if (Array.isArray(segments) && segments.length > 0) {
      const segmentQuoteMatches = segments.some((segment) => {
        if (!segment || typeof segment !== "object") return false;
        const quote = normalizeText((segment as { quote?: unknown }).quote);
        return !!quote && extractedQuoteSet.has(quote);
      });

      if (!segmentQuoteMatches) {
        console.error(
          `[board] derivation segments do not include any quote saved for thesis ${thesisId}. Refusing POST.`,
        );
        process.exit(1);
      }
    }
  }
}

// If this POST belongs to an active source run, bind the trade to that source_id.
// This prevents multi-thesis / timeline runs from fragmenting into separate sources
// when individual trade payloads use per-thesis source_url values.
try {
  const { getStreamContext } = await import("./stream-context");
  const ctx = getStreamContext(runId);
  if (ctx && !body.source_id) {
    body.source_id = ctx.source_id;
    payload = JSON.stringify(body);
  }
} catch { /* stream context is optional */ }

let extractedForPayload: SavedExtractionRecord | null = null;
try {
  if (runId) {
    const thesisId = typeof body.thesis_id === "string" ? body.thesis_id.trim() : "";
    if (thesisId) {
      extractedForPayload = await loadExtractionById(runId, thesisId);
      hydratePayloadFromSavedExtraction(body as Record<string, unknown>, extractedForPayload);
      payload = JSON.stringify(body);
    }
  }
} catch {
  // non-fatal
}

await validatePayloadAgainstSavedExtraction(runId, body as Record<string, unknown>);

// Auto-provision API key if missing, resolve base URL
import { ensureKey, getBaseUrl } from "./ensure-key";
const baseUrl = getBaseUrl();
const apiKey = await ensureKey();
if (!apiKey) {
  console.error("[board] No API key — trade will not be attributed. Run failed.");
  process.exit(1);
}

await enrichBaselineViaAssess(body as Record<string, unknown>, baseUrl, apiKey);
payload = JSON.stringify(body);

console.error(`[board] POST to ${baseUrl}/api/trades`);

const headers: Record<string, string> = { "Content-Type": "application/json" };
headers["Authorization"] = `Bearer ${apiKey}`;

const res = await fetch(`${baseUrl}/api/trades`, {
  method: "POST",
  headers,
  body: payload,
});

const text = await res.text();
if (!res.ok) {
  console.error(`[board] Failed (${res.status}): ${text}`);
  process.exit(1);
}

// Surface API warnings so the operator sees data quality issues during /trade runs
try {
  const result = JSON.parse(text);
  if (result.warnings && Array.isArray(result.warnings)) {
    for (const w of result.warnings) {
      console.error(`[API WARNING] ${w}`);
    }
    if (result.warnings.length >= 3) {
      console.error(`[API] ${result.warnings.length} warnings on trade POST — review output above`);
    }
  }
} catch { /* response wasn't JSON — unusual but non-fatal */ }

console.log(text);

appendTraceEvent({
  type: "trade_run_trade_posted",
  runIdHash: runId ? hashForTrace(runId) : null,
  ticker: typeof body.ticker === "string" ? body.ticker : null,
  direction: typeof body.direction === "string" ? body.direction : null,
  thesisId: typeof body.thesis_id === "string" ? body.thesis_id : null,
  payloadChars: payload.length,
});

// Verification nudge — show once around the 3rd successful trade
try {
  const { join: joinPath } = await import("path");
  const { readFileSync: rf, writeFileSync: wf, mkdirSync } = await import("fs");
  const counterDir = joinPath(import.meta.dir, "..", "..", "..", ".claude");
  const nudgeFile = joinPath(counterDir, ".trade-count");
  let count = 0;
  try { count = parseInt(rf(nudgeFile, "utf8").trim(), 10) || 0; } catch { /* first run */ }
  count++;
  try {
    mkdirSync(counterDir, { recursive: true });
    wf(nudgeFile, String(count));
  } catch { /* non-fatal */ }

  if (count === 3) {
    console.error(`[paste.trade] Tip: Claim your X handle — run /verify @yourhandle`);
  }
} catch { /* nudge is entirely optional */ }

// Auto-push trade_routed event if streaming context exists
try {
  const { getStreamContext, pushEvent } = await import("./stream-context");
  const ctx = getStreamContext(runId);
  if (ctx) {
    // Push trade_routed so the viewer sees the ticker badge on the thesis pill
    await pushEvent(ctx.source_id, "trade_routed", {
      message: `${body.ticker} ${body.direction?.toUpperCase()} at $${body.entry_price}`,
      thesis_id: body.thesis_id ?? null,
      ticker: body.ticker,
      direction: body.direction,
      platform: body.platform,
      entry_price: body.entry_price,
    }, { runId });

    if (body.source_theses && Array.isArray(body.source_theses)) {
      console.error("[board] source_theses detected on trade POST. Finalize explicitly with bun run skill-dev/skill-v2-lab/scripts/finalize-source.ts ...");
    }
  }
} catch { /* streaming is optional */ }
