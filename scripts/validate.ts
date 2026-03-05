/**
 * Shared thesis validation — used by save.ts and batch-save.ts.
 */

export interface ThesisWho {
  ticker: string;
  direction: string;
  enriched?: boolean;
}

export interface WhyCitation {
  text: string;
  url?: string;
  origin?: "research" | "inference";
}

export interface ThesisObject {
  thesis: string;
  horizon?: string;
  who?: ThesisWho[];
  why: (string | WhyCitation)[];
  quotes: string[];
  headline: string;
  route_status?: "routed" | "unrouted";
  routed?: boolean;
  unrouted_reason?: string;
  route_evidence?: RouteEvidence;
  [key: string]: unknown;
}

export type SubjectKind = "asset" | "company" | "event";

export type FallbackReasonTag =
  | "direct_unavailable"
  | "direct_unpriceable"
  | "direct_mismatch"
  | "direct_weaker_fit";

export interface RouteEvidenceSubject {
  label: string;
  subject_kind?: SubjectKind;
  source_quote?: string;
}

export interface RouteEvidenceDirectCheck {
  subject_label: string;
  ticker_tested: string;
  subject_kind?: SubjectKind;
  executable: boolean;
  perps_available?: boolean;
  shares_available?: boolean;
  assess_args?: string;
  notes?: string[];
}

export interface RouteEvidenceSelectedExpression {
  ticker: string;
  direction?: string;
  instrument?: string;
  platform?: string;
  trade_type?: string;
}

export interface RouteEvidence {
  schema_version?: number;
  subjects: RouteEvidenceSubject[];
  direct_checks: RouteEvidenceDirectCheck[];
  selected_expression: RouteEvidenceSelectedExpression;
  fallback_reason_tag?: FallbackReasonTag | null;
  fallback_reason_text?: string | null;
}

const FALLBACK_REASON_TAGS = new Set<FallbackReasonTag>([
  "direct_unavailable",
  "direct_unpriceable",
  "direct_mismatch",
  "direct_weaker_fit",
]);

export function normalizeRouteStatus(t: Record<string, unknown>): "routed" | "unrouted" | null {
  const raw = typeof t.route_status === "string" ? t.route_status.trim().toLowerCase() : "";
  if (raw === "routed" || raw === "unrouted") return raw;
  if (typeof t.routed === "boolean") return t.routed ? "routed" : "unrouted";
  return null;
}

function normalizeToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizeLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function validate(
  obj: unknown,
  options?: { requireRouteEvidence?: boolean },
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const requireRouteEvidence = options?.requireRouteEvidence ?? true;
  if (!obj || typeof obj !== "object") {
    return { valid: false, errors: ["Input is not a JSON object"] };
  }

  const t = obj as Record<string, unknown>;
  const routeStatus = normalizeRouteStatus(t);

  if (!routeStatus) {
    errors.push("Missing route decision: set route_status to 'routed' or 'unrouted'");
  }

  if (typeof t.thesis !== "string" || !t.thesis.trim()) {
    errors.push("Missing or empty 'thesis' field");
  }

  if (routeStatus === "routed") {
    if (!Array.isArray(t.who) || t.who.length === 0) {
      errors.push("Routed thesis must include non-empty 'who' array");
    }

    if (requireRouteEvidence) {
      const routeEvidence = t.route_evidence;
      if (!routeEvidence || typeof routeEvidence !== "object" || Array.isArray(routeEvidence)) {
        errors.push("Routed thesis must include route_evidence with direct checks");
      } else {
        const evidence = routeEvidence as Record<string, unknown>;
        const subjects = Array.isArray(evidence.subjects) ? evidence.subjects : null;
        const directChecks = Array.isArray(evidence.direct_checks) ? evidence.direct_checks : null;
        const selectedExpression =
          evidence.selected_expression && typeof evidence.selected_expression === "object" && !Array.isArray(evidence.selected_expression)
            ? (evidence.selected_expression as Record<string, unknown>)
            : null;

        if (!subjects || subjects.length === 0) {
          errors.push("route_evidence.subjects must be a non-empty array");
        }
        if (!directChecks || directChecks.length === 0) {
          errors.push("route_evidence.direct_checks must be a non-empty array");
        }
        if (!selectedExpression) {
          errors.push("route_evidence.selected_expression is required");
        }

        const subjectLabels = new Set<string>();
        if (subjects) {
          for (let i = 0; i < subjects.length; i++) {
            const subject = subjects[i];
            if (!subject || typeof subject !== "object" || Array.isArray(subject)) {
              errors.push(`route_evidence.subjects[${i}] must be an object`);
              continue;
            }
            const label = normalizeLabel((subject as Record<string, unknown>).label);
            if (!label) {
              errors.push(`route_evidence.subjects[${i}].label is required`);
              continue;
            }
            subjectLabels.add(label);
          }
        }

        const checkedLabels = new Set<string>();
        const directTickers = new Set<string>();
        const executableDirectTickers = new Set<string>();
        if (directChecks) {
          for (let i = 0; i < directChecks.length; i++) {
            const check = directChecks[i];
            if (!check || typeof check !== "object" || Array.isArray(check)) {
              errors.push(`route_evidence.direct_checks[${i}] must be an object`);
              continue;
            }
            const checkRecord = check as Record<string, unknown>;
            const subjectLabel = normalizeLabel(checkRecord.subject_label);
            if (!subjectLabel) {
              errors.push(`route_evidence.direct_checks[${i}].subject_label is required`);
            } else {
              checkedLabels.add(subjectLabel);
            }

            const tickerTested = normalizeToken(checkRecord.ticker_tested);
            if (!tickerTested) {
              errors.push(`route_evidence.direct_checks[${i}].ticker_tested is required`);
            } else {
              directTickers.add(tickerTested);
            }

            if (typeof checkRecord.executable !== "boolean") {
              errors.push(`route_evidence.direct_checks[${i}].executable must be boolean`);
            } else if (checkRecord.executable === true && tickerTested) {
              executableDirectTickers.add(tickerTested);
            }
          }
        }

        for (const subjectLabel of subjectLabels) {
          if (!checkedLabels.has(subjectLabel)) {
            errors.push(`route_evidence missing direct_check for subject "${subjectLabel}"`);
          }
        }

        const whoTickers = new Set(
          Array.isArray(t.who)
            ? t.who
                .map((item) => normalizeToken((item as Record<string, unknown>).ticker))
                .filter(Boolean)
            : [],
        );

        const selectedTicker = normalizeToken(selectedExpression?.ticker);
        if (!selectedTicker) {
          errors.push("route_evidence.selected_expression.ticker is required");
        }

        if (selectedExpression) {
          for (const field of ["direction", "instrument", "platform", "trade_type"] as const) {
            const value = selectedExpression[field];
            if (value != null && (typeof value !== "string" || !value.trim())) {
              errors.push(`route_evidence.selected_expression.${field} must be a non-empty string when provided`);
            }
          }
        }

        if (selectedTicker && whoTickers.size > 0 && !whoTickers.has(selectedTicker)) {
          errors.push("route_evidence.selected_expression.ticker must match one of who[].ticker");
        }

        const fallbackTagRaw = evidence.fallback_reason_tag;
        const fallbackTag = typeof fallbackTagRaw === "string" ? fallbackTagRaw.trim() : "";
        const hasFallbackTag = fallbackTag.length > 0;
        if (hasFallbackTag && !FALLBACK_REASON_TAGS.has(fallbackTag as FallbackReasonTag)) {
          errors.push("route_evidence.fallback_reason_tag is invalid");
        }

        const isProxySelection = selectedTicker && !directTickers.has(selectedTicker);
        if (isProxySelection && !hasFallbackTag) {
          errors.push("Proxy route requires route_evidence.fallback_reason_tag");
        }

        if (isProxySelection && executableDirectTickers.size > 0) {
          if (fallbackTag !== "direct_weaker_fit") {
            errors.push("Proxy route with executable direct checks requires fallback_reason_tag=direct_weaker_fit");
          }
          const fallbackText = typeof evidence.fallback_reason_text === "string" ? evidence.fallback_reason_text.trim() : "";
          if (!fallbackText) {
            errors.push("Proxy route with executable direct checks requires non-empty fallback_reason_text");
          }
        }
      }
    }
  }

  if (Array.isArray(t.who)) {
    for (let i = 0; i < t.who.length; i++) {
      const w = t.who[i] as Record<string, unknown>;
      if (!w.ticker) errors.push(`who[${i}]: missing ticker`);
      if (!w.direction) errors.push(`who[${i}]: missing direction`);
    }
  }

  if (routeStatus === "unrouted") {
    if (typeof t.unrouted_reason !== "string" || !t.unrouted_reason.trim()) {
      errors.push("Unrouted thesis must include non-empty 'unrouted_reason'");
    }
  }

  if (!Array.isArray(t.why) || t.why.length === 0) {
    errors.push("Missing or empty 'why' array");
  } else {
    for (let i = 0; i < t.why.length; i++) {
      const entry = t.why[i];
      if (typeof entry === "string") continue;
      if (typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).text === "string") continue;
      errors.push(`why[${i}]: must be a string or { text, url?, origin? }`);
    }
  }

  const normalizedQuoteSet = new Set<string>();
  if (!Array.isArray(t.quotes) || t.quotes.length === 0) {
    errors.push("Missing or empty 'quotes' array");
  } else {
    for (let i = 0; i < t.quotes.length; i++) {
      const quote = t.quotes[i];
      if (typeof quote !== "string" || !quote.trim()) {
        errors.push(`quotes[${i}]: must be a non-empty string`);
        continue;
      }
      normalizedQuoteSet.add(normalizeText(quote));
    }
  }

  if (typeof t.headline !== "string" || !t.headline.trim()) {
    errors.push("Missing or empty 'headline' field");
  } else {
    if (t.headline.length > 180) {
      errors.push(`headline is ${t.headline.length} chars (max: 180)`);
    }
    const normalizedHeadline = normalizeText(t.headline);
    if (normalizedQuoteSet.size > 0 && normalizedHeadline && !normalizedQuoteSet.has(normalizedHeadline)) {
      errors.push("headline must exactly match one quotes[] entry");
    }
  }

  return { valid: errors.length === 0, errors };
}
