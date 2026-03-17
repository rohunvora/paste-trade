/**
 * Board API POST
 *
 * Wraps the HTTP POST so BOARD_URL from .env is available.
 * Accepts JSON payload as CLI argument or via stdin (for large payloads
 * that break shell quoting).
 *
 * Usage:
 *   bun run skill/scripts/post.ts '<JSON payload>'
 *   echo '<JSON>' | bun run skill/scripts/post.ts
 */

import { applyRunId, extractRunIdArg } from "./run-id";
import { appendTraceEvent, hashForTrace } from "./trace-audit";
import { toFiniteNumber } from "../shared/trade-pricing";
import { existsSync } from "fs";
import { getRuntimeExtractionDir, getUserStateDir } from "./runtime-paths";

const { runId, args } = extractRunIdArg(process.argv);
applyRunId(runId);

let payload = args[0];
if (!payload) {
  // Read from stdin if no CLI arg
  payload = await Bun.stdin.text();
}
if (!payload?.trim()) {
  console.error("Usage: bun run skill/scripts/post.ts '<JSON payload>' (or pipe via stdin)");
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
  author_date?: unknown;
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

/** Strip venue/dex prefix from HL-style tickers like "xyz:NVDA" -> "NVDA" */
function stripVenuePrefix(ticker: string): string {
  const idx = ticker.indexOf(":");
  return idx === -1 ? ticker : ticker.slice(idx + 1);
}

// toFiniteNumber imported from shared/trade-pricing

// applyCanonicalAuthorPrice removed — exact_author_price field was dropped.
// author_price is now the single canonical price column.

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
  const extractionDir = getRuntimeExtractionDir();
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

  const normalizedAuthorDate = normalizeIsoDateTime(tradeBody.author_date)
    ?? normalizeIsoDateTime(extracted.author_date);
  if (normalizedAuthorDate) tradeBody.author_date = normalizedAuthorDate;

  if (typeof tradeBody.headline_quote !== "string" || !tradeBody.headline_quote.trim()) {
    if (typeof extracted.headline_quote === "string" && extracted.headline_quote.trim()) {
      tradeBody.headline_quote = extracted.headline_quote.trim();
    } else if (Array.isArray(extracted.quotes)) {
      const firstQuote = extracted.quotes.find((q) => typeof q === "string" && q.trim());
      if (typeof firstQuote === "string" && firstQuote.trim()) {
        tradeBody.headline_quote = firstQuote.trim();
      }
    }
  }

  const check = resolveDirectCheckForTicker(extracted, normalizeTicker(tradeBody.ticker));
  const selectedEntryPrice = toFiniteNumber(selected?.author_price);
  const checkEntryPrice = toFiniteNumber(check?.author_price);
  if (toFiniteNumber(tradeBody.author_price) == null) {
    const candidateEntry = selectedEntryPrice ?? checkEntryPrice;
    if (candidateEntry != null && candidateEntry > 0) tradeBody.author_price = candidateEntry;
  }

  // exact_author_price and author_to_posted_pct were dropped from the schema.
  // author_price is the single canonical price column, set above.
}

interface BackendAssessMinimal {
  results?: Array<{
    author_price?: number;
  }>;
}

/** Enrich author_price from the assess endpoint if missing.
 *  The assess endpoint returns the historical price at author_date for the given ticker.
 *  Only needed for stocks/perps — PM trades set author_price from the contract price. */
async function enrichBaselineViaAssess(
  tradeBody: Record<string, unknown>,
  baseUrl: string,
  apiKey: string,
): Promise<void> {
  const ticker = normalizeTicker(tradeBody.ticker);
  const authorDate = normalizeIsoDateTime(tradeBody.author_date);
  if (!ticker || !authorDate) return;
  tradeBody.author_date = authorDate;

  // Skip if author_price is already set
  if (toFiniteNumber(tradeBody.author_price) != null) return;

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
        source_date: authorDate,
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

    const assessPrice = toFiniteNumber(row.author_price);
    if (assessPrice != null && assessPrice > 0) {
      tradeBody.author_price = assessPrice;
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
      console.log(JSON.stringify({ ok: false, error: `routed thesis ${thesisId} is missing route_evidence` }));
      process.exit(0);
    }

    const routeEvidence = extracted.route_evidence as Record<string, unknown>;
    const selectedExpression =
      routeEvidence.selected_expression &&
      typeof routeEvidence.selected_expression === "object" &&
      !Array.isArray(routeEvidence.selected_expression)
        ? (routeEvidence.selected_expression as Record<string, unknown>)
        : null;
    if (!selectedExpression) {
      console.log(JSON.stringify({ ok: false, error: `routed thesis ${thesisId} is missing route_evidence.selected_expression` }));
      process.exit(0);
    }

    const selectedTicker = normalizeTicker(selectedExpression.ticker);
    const postedTicker = normalizeTicker(tradeBody.ticker);
    if (selectedTicker && postedTicker && selectedTicker !== postedTicker && stripVenuePrefix(selectedTicker) !== postedTicker && selectedTicker !== stripVenuePrefix(postedTicker)) {
      console.log(JSON.stringify({ ok: false, error: `posted ticker ${postedTicker} does not match selected_expression ticker ${selectedTicker} for thesis ${thesisId}` }));
      process.exit(0);
    }

    for (const field of ["direction", "instrument", "platform", "trade_type"] as const) {
      const selectedValue = typeof selectedExpression[field] === "string" ? selectedExpression[field]!.trim().toLowerCase() : "";
      const postedValue = typeof tradeBody[field] === "string" ? String(tradeBody[field]).trim().toLowerCase() : "";
      if (selectedValue && postedValue && selectedValue !== postedValue) {
        console.log(JSON.stringify({ ok: false, error: `posted ${field}=${postedValue} does not match selected_expression ${field}=${selectedValue} for thesis ${thesisId}` }));
        process.exit(0);
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

    const selectedIsProxy = !!(selectedTicker && !directTickers.has(selectedTicker) && !directTickers.has(stripVenuePrefix(selectedTicker)));
    const fallbackTag = typeof routeEvidence.fallback_reason_tag === "string" ? routeEvidence.fallback_reason_tag.trim() : "";

    if (selectedIsProxy) {
      if (!fallbackTag || !FALLBACK_REASON_TAGS.has(fallbackTag)) {
        console.log(JSON.stringify({ ok: false, error: `proxy route for thesis ${thesisId} is missing valid fallback_reason_tag` }));
        process.exit(0);
      }
      if (executableDirectTickers.size > 0 && fallbackTag !== "direct_weaker_fit") {
        console.log(JSON.stringify({ ok: false, error: `proxy route for thesis ${thesisId} has executable direct checks and must use fallback_reason_tag=direct_weaker_fit` }));
        process.exit(0);
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
      // Also accept headline as substring of any saved quote (headline is a <=120 char excerpt)
      const isSubstring = [...extractedQuoteSet].some(q => q.includes(headlineQuote));
      if (!isSubstring) {
        console.log(JSON.stringify({ ok: false, error: `headline_quote must match or be a substring of thesis quotes saved in extraction ${thesisId}` }));
        process.exit(0);
      }
    }

    const segments = (tradeBody.derivation as { segments?: unknown } | undefined)?.segments;
    if (Array.isArray(segments) && segments.length > 0) {
      const segmentQuoteMatches = segments.some((segment) => {
        if (!segment || typeof segment !== "object") return false;
        const quote = normalizeText((segment as { quote?: unknown }).quote);
        if (!quote) return false;
        // Accept exact match or substring/superstring of any saved quote
        return extractedQuoteSet.has(quote) || [...extractedQuoteSet].some(q => q.includes(quote) || quote.includes(q));
      });

      if (!segmentQuoteMatches) {
        console.log(JSON.stringify({ ok: false, error: `derivation segments do not include any quote matching thesis ${thesisId}` }));
        process.exit(0);
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

// Preserve prefixed HL ticker for deeplinks (e.g., "cash:HOOD") before stripping.
// The display ticker stays bare ("HOOD"), but deeplinks need the full prefix.
if (typeof body.ticker === "string" && body.ticker.includes(":")) {
  body.hl_ticker = body.ticker;
  body.ticker = stripVenuePrefix(body.ticker);
  payload = JSON.stringify(body);
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

// Polymarket trades use probability prices (0-1), not stock prices.
// Skip /api/skill/assess enrichment (Yahoo Finance) which would corrupt them.
const platform = typeof body.platform === "string" ? body.platform : "";
if (platform === "polymarket") {
  // Capture pm_side before normalizing direction (YES/NO → long/short)
  if (body.direction === "yes" || body.direction === "no") {
    body.pm_side = body.direction;
  }
  // Normalize PM direction: skill LLM may output "yes"/"no" instead of "long"/"short"
  if (body.direction === "yes") body.direction = "long";
  if (body.direction === "no") body.direction = "short";
  // Normalize PM instrument: must be "polymarket" for frontend display (YES/NO, cent pricing, PmBlock)
  if (typeof body.instrument === "string" && body.instrument !== "polymarket") body.instrument = "polymarket";

  // Contract price: pm_yes_no_price is the YES token price (0-1).
  // author_price also gets set to this value for P&L computation.
  const buyPrice = toFiniteNumber(body.buy_price_usd ?? body.pm_yes_no_price);
  if (buyPrice != null && buyPrice > 0 && buyPrice <= 1) {
    body.pm_yes_no_price = buyPrice;
    body.author_price = buyPrice;
  }
  // Warn if PM price looks like a stock price (should be 0-1 probability)
  const pubPrice = toFiniteNumber(body.author_price);
  if (pubPrice != null && pubPrice > 1) {
    console.error(`[post] PM trade has stock-scale author_price: ${pubPrice} — expected 0-1 range`);
  }
} else {
  await enrichBaselineViaAssess(body as Record<string, unknown>, baseUrl, apiKey);
}

payload = JSON.stringify(body);

// Resolve author avatar locally (fxtwitter works from user machines, not CF Workers).
// If the payload already has author_avatar_url, skip. Otherwise try to fetch it.
// Always attempt for handles that look like X usernames (no spaces, ≤15 chars) regardless
// of which platform the trade routes to — the trade venue (hyperliquid/robinhood) is NOT
// the author's platform.
if (typeof body.author_handle === "string" && body.author_handle.trim() && !body.author_avatar_url) {
  const handle = body.author_handle.replace(/^@/, "").trim();
  const looksLikeXHandle = handle.length <= 15 && /^[A-Za-z0-9_]+$/.test(handle);
  if (looksLikeXHandle) {
    try {
      const res = await fetch(`https://api.fxtwitter.com/${handle}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json() as { user?: { avatar_url?: string } };
        const url = data.user?.avatar_url;
        if (url) {
          body.author_avatar_url = url.replace(/_normal\./, "_400x400.");
          payload = JSON.stringify(body);
        }
      }
    } catch {
      // Non-fatal — backend asset job will retry
    }
  }
}

const { streamLog } = await import("./stream-log");
streamLog(`Posting trade: ${(body as any).ticker} ${(body as any).direction}`);

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
  const counterDir = getUserStateDir();
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

// Auto-push trade_posted event (v2 only — frontend maps v1 trade_routed → thesis_routed)
try {
  const { getStreamContext, pushEvent } = await import("./stream-context");
  const ctx = getStreamContext(runId);
  if (ctx) {
    await pushEvent(ctx.source_id, "trade_posted", {
      thesis_id: body.thesis_id ?? null,
      ticker: body.ticker,
      direction: body.direction,
      trade_id: (() => { try { return JSON.parse(text).id; } catch { return null; } })(),
    }, { runId });

    if (body.source_theses && Array.isArray(body.source_theses)) {
      console.error("[board] source_theses detected on trade POST. Finalize explicitly with bun run skill/scripts/finalize-source.ts ...");
    }
  }
} catch { /* streaming is optional */ }
