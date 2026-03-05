import type { Liquidity } from "../../types";

const API = "https://api.hyperliquid.xyz/info";
// Resolved lazily — Workers doesn't support new URL() with import.meta.url at module scope
function getAnnotationCachePath(): string | null {
  try {
    return new URL("./annotation-cache.json", import.meta.url).pathname;
  } catch {
    return null; // Workers environment — no filesystem access
  }
}

export const DEFAULT_ENABLED_DEXES = ["xyz", "vntl", "cash", "km", "flx", "hyna"] as const;

const DEX_PRIORITY = ["default", "xyz", "cash", "km", "vntl", "flx", "hyna", "abcd"] as const;

type AssetClass =
  | "crypto"
  | "equity"
  | "index"
  | "commodity"
  | "fx"
  | "private_valuation"
  | "other";

type MatchKind = "exact" | "prefixed" | "alias" | "query";

interface HLMeta {
  universe: Array<{
    name: string;
    szDecimals: number;
    maxLeverage: number;
    marginTableId?: number;
  }>;
}

interface HLAssetCtx {
  funding: string;
  openInterest: string;
  dayNtlVlm: string;
  dayBaseVlm?: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
  prevDayPx: string;
  premium: string;
}

interface HLPerpDexRaw {
  name: string;
  fullName?: string;
  deployer?: string | null;
  oracleUpdater?: string | null;
  feeRecipient?: string | null;
  assetToStreamingOiCap?: Array<[string, string]>;
  assetToFundingMultiplier?: Array<[string, string]>;
  assetToFundingInterestRate?: Array<[string, string]>;
}

interface HLPerpAnnotationRaw {
  category?: string | null;
  description?: string | null;
}

interface SemanticMetadata {
  asset_class: AssetClass;
  theme_tags: string[];
  instrument_description?: string;
  pricing_note?: string;
}

const PRIVATE_VALUATION_BASES = new Set(["SPACEX", "OPENAI", "ANTHROPIC"]);
const INDEX_BASES = new Set([
  "XYZ100",
  "MAG7",
  "SEMIS",
  "ROBOT",
  "INFOTECH",
  "NUCLEAR",
  "DEFENSE",
  "ENERGY",
  "BIOTECH",
  "GOLDJM",
  "SILVERJM",
  "USA500",
  "US500",
  "USTECH",
  "USBOND",
  "SMALL2000",
  "USENERGY",
  "SEMI",
  "GLDMINE",
  "KR200",
  "JP225",
  "EWJ",
  "EWY",
  "URNM",
  "DXY",
]);
const COMMODITY_BASES = new Set([
  "GOLD",
  "SILVER",
  "PLATINUM",
  "PALLADIUM",
  "CL",
  "OIL",
  "USOIL",
  "NATGAS",
  "COPPER",
  "ALUMINIUM",
]);
const FX_BASES = new Set(["EUR", "JPY"]);

const THEME_TAGS_BY_BASE: Record<string, string[]> = {
  SPACEX: ["private-markets", "space", "aerospace"],
  OPENAI: ["private-markets", "ai"],
  ANTHROPIC: ["private-markets", "ai"],
  DEFENSE: ["defense", "aerospace"],
  NUCLEAR: ["nuclear", "energy"],
  ENERGY: ["energy", "oil-gas"],
  SEMIS: ["semiconductors", "ai"],
  INFOTECH: ["technology"],
  MAG7: ["mega-cap-tech"],
  ROBOT: ["robotics", "automation"],
  BIOTECH: ["biotech", "healthcare"],
  GOLDJM: ["gold", "miners"],
  SILVERJM: ["silver", "miners"],
  XYZ100: ["us-tech-index"],
  USA500: ["us-large-cap-index"],
  US500: ["us-large-cap-index"],
  USTECH: ["us-tech-index"],
  USBOND: ["rates", "bonds"],
  USENERGY: ["energy"],
  GLDMINE: ["gold", "miners"],
  GOLD: ["gold"],
  SILVER: ["silver"],
  CL: ["oil"],
  OIL: ["oil"],
  USOIL: ["oil"],
  NATGAS: ["natural-gas"],
  COPPER: ["industrial-metals"],
  ALUMINIUM: ["industrial-metals"],
  URNM: ["uranium"],
  USAR: ["rare-earths", "materials"],
  COIN: ["crypto-equity"],
  MSTR: ["bitcoin-proxy"],
};

const DESCRIPTION_BY_BASE: Record<string, string> = {
  SPACEX: "Private company valuation perpetual for SpaceX.",
  OPENAI: "Private company valuation perpetual for OpenAI.",
  ANTHROPIC: "Private company valuation perpetual for Anthropic.",
  DEFENSE: "Thematic index perpetual tracking defense-related equities.",
  NUCLEAR: "Thematic index perpetual tracking nuclear-related equities.",
  SEMIS: "Thematic index perpetual tracking semiconductor equities.",
  MAG7: "Thematic index perpetual tracking a mega-cap U.S. technology basket.",
  USA500: "U.S. large-cap equity index perpetual.",
  US500: "U.S. large-cap equity index perpetual.",
  USTECH: "U.S. technology index perpetual.",
  USBOND: "U.S. bond/rates exposure perpetual.",
  XYZ100: "U.S. growth-oriented equity index perpetual.",
};

const PRICING_NOTE_BY_BASE: Record<string, string> = {
  SPACEX: "Contract price tracks company valuation divided by 1B.",
  OPENAI: "Contract price tracks company valuation divided by 1B.",
  ANTHROPIC: "Contract price tracks company valuation divided by 1B.",
};

const ASSET_CLASS_BY_PERP_CATEGORY: Record<string, AssetClass> = {
  stocks: "equity",
  indices: "index",
  commodities: "commodity",
  preipo: "private_valuation",
  fx: "fx",
};

export interface HlInstrument {
  full_symbol: string;
  base_symbol: string;
  dex: string;
  dex_full_name: string;
  mark_price?: number;
  oracle_price?: number;
  mid_price?: number;
  funding_rate_hourly?: number;
  funding_rate_annualized_pct?: number;
  open_interest_usd?: number;
  volume_24h_usd?: number;
  max_leverage?: number;
  liquidity?: Liquidity;
  oi_cap_usd?: number;
  funding_multiplier?: number;
  funding_interest_rate?: number;
  asset_class: AssetClass;
  theme_tags: string[];
  instrument_description?: string;
  pricing_note?: string;
  source_warnings?: string[];
}

export interface HlDexSummary {
  dex: string;
  full_name: string;
  assets: number;
}

export interface HlUniverse {
  instruments: HlInstrument[];
  by_full_lower: Map<string, HlInstrument>;
  by_base_upper: Map<string, HlInstrument[]>;
  dex_summaries: HlDexSummary[];
  enabled_dexes: string[];
  diagnostics: HlUniverseBuildDiagnostics;
}

export interface HlUniverseBuildFailure {
  dex: string;
  reason: string;
}

export interface HlUniverseBuildDiagnostics {
  requested_dexes: string[];
  loaded_dexes: string[];
  failed_dexes: HlUniverseBuildFailure[];
  degraded: boolean;
  warnings: string[];
}

export interface HlResolution {
  instrument: HlInstrument;
  match_kind: MatchKind;
  confidence: number;
  selection_reason: string;
}

export interface HlQueryResult extends HlResolution {
  score: number;
}

interface BuildUniverseOptions {
  enabled_dexes?: string[];
  strict?: boolean;
}

interface AnnotationCacheFile {
  fetched_at?: string;
  annotations?: Record<string, HLPerpAnnotationRaw>;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function assessLiquidity(dayNtlVlm: number | undefined): Liquidity | undefined {
  if (dayNtlVlm == null) return undefined;
  if (dayNtlVlm >= 100_000_000) return "high";
  if (dayNtlVlm >= 10_000_000) return "medium";
  return "low";
}

function dexPriorityIndex(dex: string): number {
  const idx = DEX_PRIORITY.indexOf(dex as (typeof DEX_PRIORITY)[number]);
  return idx === -1 ? DEX_PRIORITY.length : idx;
}

function compareByPolicy(a: HlInstrument, b: HlInstrument): number {
  const volA = a.volume_24h_usd ?? -1;
  const volB = b.volume_24h_usd ?? -1;
  if (volA !== volB) return volB - volA;

  const levA = a.max_leverage ?? -1;
  const levB = b.max_leverage ?? -1;
  if (levA !== levB) return levB - levA;

  const prio = dexPriorityIndex(a.dex) - dexPriorityIndex(b.dex);
  if (prio !== 0) return prio;

  return a.full_symbol.localeCompare(b.full_symbol);
}

function splitSymbol(name: string): { dex: string; base: string } {
  const idx = name.indexOf(":");
  if (idx === -1) return { dex: "default", base: name };
  return {
    dex: name.slice(0, idx).toLowerCase(),
    base: name.slice(idx + 1),
  };
}

function normalizeBaseSymbol(base: string): string {
  const trimmed = base.trim();
  if (!trimmed) return "";
  if (/^k[a-z0-9]+$/i.test(trimmed)) return `k${trimmed.slice(1).toUpperCase()}`;
  return trimmed.toUpperCase();
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
}

function inferSemanticMetadata(dex: string, baseSymbol: string): SemanticMetadata {
  const baseUpper = baseSymbol.toUpperCase();

  let assetClass: AssetClass = "other";
  if (dex === "default" || dex === "hyna") {
    assetClass = "crypto";
  } else if (PRIVATE_VALUATION_BASES.has(baseUpper)) {
    assetClass = "private_valuation";
  } else if (INDEX_BASES.has(baseUpper)) {
    assetClass = "index";
  } else if (COMMODITY_BASES.has(baseUpper)) {
    assetClass = "commodity";
  } else if (FX_BASES.has(baseUpper)) {
    assetClass = "fx";
  } else if (["xyz", "km", "cash", "flx", "vntl"].includes(dex)) {
    assetClass = "equity";
  }

  return {
    asset_class: assetClass,
    theme_tags: THEME_TAGS_BY_BASE[baseUpper] ?? [],
    instrument_description: DESCRIPTION_BY_BASE[baseUpper],
    pricing_note: PRICING_NOTE_BY_BASE[baseUpper],
  };
}

async function postInfo<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Hyperliquid API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

async function fetchMetaAndCtxs(dex?: string): Promise<{ meta: HLMeta; ctxs: HLAssetCtx[] }> {
  const body: Record<string, unknown> = { type: "metaAndAssetCtxs" };
  if (dex) body.dex = dex;
  const [meta, ctxs] = await postInfo<[HLMeta, HLAssetCtx[]]>(body);
  return { meta, ctxs };
}

function arrayPairsToMap(entries: Array<[string, string]> | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!entries?.length) return map;
  for (const [key, raw] of entries) {
    const value = parseNumber(raw);
    if (value != null) map.set(key, value);
  }
  return map;
}

function normalizeEnabledDexes(input?: string[]): string[] {
  const source = input ?? [...DEFAULT_ENABLED_DEXES];
  const normalized = source
    .map((dex) => dex.trim().toLowerCase())
    .filter(Boolean)
    .filter((dex) => dex !== "default");
  return [...new Set(normalized)];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function loadAnnotationDescriptionCache(warnings: string[]): Promise<Map<string, string>> {
  const cachePath = getAnnotationCachePath();
  if (!cachePath || typeof globalThis.Bun === "undefined") {
    warnings.push("annotation-cache.json unavailable (non-Bun environment); using hardcoded instrument descriptions only.");
    return new Map();
  }
  const cacheFile = Bun.file(cachePath);

  try {
    if (!(await cacheFile.exists())) {
      warnings.push("annotation-cache.json missing; using hardcoded instrument descriptions only.");
      return new Map();
    }
  } catch (error) {
    warnings.push(
      `annotation-cache.json lookup failed (${errorMessage(error)}); using hardcoded instrument descriptions only.`
    );
    return new Map();
  }

  try {
    const parsed = await cacheFile.json() as AnnotationCacheFile;
    if (!parsed || typeof parsed !== "object" || !parsed.annotations || typeof parsed.annotations !== "object") {
      warnings.push("annotation-cache.json malformed; using hardcoded instrument descriptions only.");
      return new Map();
    }

    const descriptions = new Map<string, string>();
    for (const [symbol, annotation] of Object.entries(parsed.annotations)) {
      if (!annotation || typeof annotation !== "object") continue;
      const description =
        typeof annotation.description === "string" && annotation.description.trim()
          ? annotation.description.trim()
          : "";
      if (!description) continue;
      descriptions.set(symbol.toLowerCase(), description);
    }
    return descriptions;
  } catch (error) {
    warnings.push(
      `annotation-cache.json parse failed (${errorMessage(error)}); using hardcoded instrument descriptions only.`
    );
    return new Map();
  }
}

function normalizePerpCategory(category: unknown): string | undefined {
  if (typeof category !== "string") return undefined;
  const normalized = category.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized;
}

function parsePerpCategoryMap(raw: unknown): Map<string, string> {
  const parsed = new Map<string, string>();
  if (!Array.isArray(raw)) return parsed;
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const symbol = entry[0];
    const category = normalizePerpCategory(entry[1]);
    if (typeof symbol !== "string" || !category) continue;
    parsed.set(symbol.trim().toLowerCase(), category);
  }
  return parsed;
}

function resolvePerpCategory(categoriesBySymbol: Map<string, string>, fullSymbol: string, dex: string, base: string): string | undefined {
  const fullKey = fullSymbol.trim().toLowerCase();
  const baseKey = base.trim().toLowerCase();
  const dexKey = `${dex}:${base}`.toLowerCase();

  return categoriesBySymbol.get(fullKey) ?? categoriesBySymbol.get(dexKey) ?? categoriesBySymbol.get(baseKey);
}

export async function buildHlUniverse(options: BuildUniverseOptions = {}): Promise<HlUniverse> {
  const strict = options.strict ?? false;
  const enabledDexes = normalizeEnabledDexes(options.enabled_dexes);
  const requestedDexes = ["default", ...enabledDexes];
  const failedDexes: HlUniverseBuildFailure[] = [];
  const warnings: string[] = [];
  const annotationDescriptionsBySymbol = await loadAnnotationDescriptionCache(warnings);

  let perpDexsAvailable = false;
  let dexMeta = new Map<string, HLPerpDexRaw>();
  let perpCategoriesBySymbol = new Map<string, string>();
  const [perpDexsResult, perpCategoriesResult] = await Promise.allSettled([
    postInfo<Array<HLPerpDexRaw | null>>({ type: "perpDexs" }),
    postInfo<unknown>({ type: "perpCategories" }),
  ]);

  if (perpDexsResult.status === "fulfilled") {
    const perpDexs = perpDexsResult.value.filter((dex): dex is HLPerpDexRaw => Boolean(dex));
    dexMeta = new Map<string, HLPerpDexRaw>(perpDexs.map((dex) => [dex.name, dex]));
    perpDexsAvailable = true;
  } else {
    const reason = errorMessage(perpDexsResult.reason);
    failedDexes.push({ dex: "perpDexs", reason });
    warnings.push("perpDexs unavailable; dex metadata fields may be partial.");
    if (strict) {
      throw new Error(`buildHlUniverse strict mode: failed to fetch perpDexs (${reason})`);
    }
  }

  if (perpCategoriesResult.status === "fulfilled") {
    perpCategoriesBySymbol = parsePerpCategoryMap(perpCategoriesResult.value);
  } else {
    const reason = errorMessage(perpCategoriesResult.reason);
    failedDexes.push({ dex: "perpCategories", reason });
    warnings.push("perpCategories unavailable; using hardcoded asset-class fallbacks.");
  }

  let toFetch = enabledDexes;
  if (perpDexsAvailable) {
    const missingDexes = enabledDexes.filter((dex) => !dexMeta.has(dex));
    for (const dex of missingDexes) {
      failedDexes.push({ dex, reason: "Requested dex not present in live perpDexs list." });
    }
    if (missingDexes.length > 0) {
      warnings.push(`Some requested dexes are not active: ${missingDexes.join(", ")}`);
    }
    toFetch = enabledDexes.filter((dex) => dexMeta.has(dex));
  }

  const fetchTasks = [
    { dex: "default", promise: fetchMetaAndCtxs() },
    ...toFetch.map((dex) => ({ dex, promise: fetchMetaAndCtxs(dex) })),
  ];

  const settled = await Promise.allSettled(fetchTasks.map((t) => t.promise));
  const instruments: HlInstrument[] = [];
  const dexSummaries: HlDexSummary[] = [];
  const loadedDexes: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const task = fetchTasks[i]!;
    const result = settled[i]!;
    if (result.status !== "fulfilled") {
      failedDexes.push({ dex: task.dex, reason: errorMessage(result.reason) });
      continue;
    }

    const { meta, ctxs } = result.value;
    const dexConfig = dexMeta.get(task.dex);
    const dexName = task.dex;
    const dexFullName = dexName === "default" ? "Hyperliquid" : (dexConfig?.fullName ?? dexName);
    loadedDexes.push(dexName);
    dexSummaries.push({ dex: dexName, full_name: dexFullName, assets: meta.universe.length });

    const oiCaps = arrayPairsToMap(dexConfig?.assetToStreamingOiCap);
    const fundingMult = arrayPairsToMap(dexConfig?.assetToFundingMultiplier);
    const fundingRate = arrayPairsToMap(dexConfig?.assetToFundingInterestRate);

    for (let idx = 0; idx < meta.universe.length; idx++) {
      const info = meta.universe[idx];
      const ctx = ctxs[idx];
      if (!info || !ctx) continue;

      const name = info.name;
      const { dex: symbolDex, base } = splitSymbol(name);
      const actualDex = symbolDex || dexName;
      const actualDexConfig = dexMeta.get(actualDex);
      const actualDexFullName = actualDex === "default" ? "Hyperliquid" : (actualDexConfig?.fullName ?? actualDex);

      const markPrice = parseNumber(ctx.markPx) ?? parseNumber(ctx.oraclePx);
      const oraclePrice = parseNumber(ctx.oraclePx);
      const midPrice = parseNumber(ctx.midPx);
      const funding = parseNumber(ctx.funding);
      const openInterest = parseNumber(ctx.openInterest);
      const dayNtlVlm = parseNumber(ctx.dayNtlVlm);

      const openInterestUsd =
        openInterest != null && oraclePrice != null ? Math.round(openInterest * oraclePrice) : undefined;

      const semantic = inferSemanticMetadata(actualDex, base);
      const perpCategory = resolvePerpCategory(perpCategoriesBySymbol, name, actualDex, base);
      const categoryAssetClass =
        perpCategory && Object.prototype.hasOwnProperty.call(ASSET_CLASS_BY_PERP_CATEGORY, perpCategory)
          ? ASSET_CLASS_BY_PERP_CATEGORY[perpCategory]
          : undefined;
      const cachedDescription = annotationDescriptionsBySymbol.get(name.toLowerCase());
      const sourceWarnings: string[] = [];
      if (actualDex === "cash" && base.toUpperCase() === "USA500") {
        sourceWarnings.push("Some dreamcash docs use US500-USDT naming; live executable symbol is cash:USA500.");
      }

      instruments.push({
        full_symbol: name,
        base_symbol: base,
        dex: actualDex,
        dex_full_name: actualDexFullName,
        mark_price: markPrice,
        oracle_price: oraclePrice,
        mid_price: midPrice,
        funding_rate_hourly: funding,
        funding_rate_annualized_pct: funding != null ? Math.round(funding * 24 * 365 * 100 * 100) / 100 : undefined,
        open_interest_usd: openInterestUsd,
        volume_24h_usd: dayNtlVlm != null ? Math.round(dayNtlVlm) : undefined,
        max_leverage: info.maxLeverage,
        liquidity: assessLiquidity(dayNtlVlm),
        oi_cap_usd: oiCaps.get(name),
        funding_multiplier: fundingMult.get(name),
        funding_interest_rate: fundingRate.get(name),
        asset_class: categoryAssetClass ?? semantic.asset_class,
        theme_tags: semantic.theme_tags,
        instrument_description: semantic.instrument_description ?? cachedDescription,
        pricing_note: semantic.pricing_note,
        source_warnings: sourceWarnings.length ? sourceWarnings : undefined,
      });
    }
  }

  if (strict && failedDexes.length > 0) {
    const summary = failedDexes.map((entry) => `${entry.dex}: ${entry.reason}`).join(" | ");
    throw new Error(`buildHlUniverse strict mode: failed dex fetches (${summary})`);
  }

  if (loadedDexes.length === 0) {
    warnings.push("No Hyperliquid dex data loaded; universe is empty.");
  }

  const byFullLower = new Map<string, HlInstrument>();
  const byBaseUpper = new Map<string, HlInstrument[]>();

  for (const instrument of instruments) {
    byFullLower.set(instrument.full_symbol.toLowerCase(), instrument);
    const key = instrument.base_symbol.toUpperCase();
    const existing = byBaseUpper.get(key) ?? [];
    existing.push(instrument);
    byBaseUpper.set(key, existing);
  }

  return {
    instruments,
    by_full_lower: byFullLower,
    by_base_upper: byBaseUpper,
    dex_summaries: dexSummaries.sort((a, b) => a.dex.localeCompare(b.dex)),
    enabled_dexes: loadedDexes,
    diagnostics: {
      requested_dexes: requestedDexes,
      loaded_dexes: loadedDexes,
      failed_dexes: failedDexes,
      degraded: failedDexes.length > 0,
      warnings,
    },
  };
}

export function summarizeUniverseDegradation(universe: HlUniverse): string | null {
  if (!universe.diagnostics.degraded) return null;
  const loaded = universe.diagnostics.loaded_dexes.join(", ") || "none";
  const failed = universe.diagnostics.failed_dexes
    .map((entry) => `${entry.dex} (${entry.reason})`)
    .join("; ");
  return `degraded universe: loaded=[${loaded}] failed=[${failed || "none"}]`;
}

function getSortedBaseMatches(universe: HlUniverse, baseKeyUpper: string): HlInstrument[] {
  return [...(universe.by_base_upper.get(baseKeyUpper) ?? [])].sort(compareByPolicy);
}

function confidenceFromScore(score: number): number {
  return Math.max(0.5, Math.min(0.95, 0.5 + score / 20));
}

export function resolveTicker(
  rawInput: string,
  universe: HlUniverse,
  opts: { allow_prefix_match?: boolean } = {}
): HlResolution | null {
  const cleaned = rawInput.trim().replace(/-PERP$/i, "");
  if (!cleaned) return null;

  // Full symbol path: dex:BASE
  if (cleaned.includes(":")) {
    const [dexRaw, ...rest] = cleaned.split(":");
    const baseRaw = rest.join(":");
    if (!dexRaw || !baseRaw) return null;

    const dex = dexRaw.toLowerCase();
    const base = normalizeBaseSymbol(baseRaw);
    const normalizedFull = dex === "default" ? base : `${dex}:${base}`;
    const match =
      universe.by_full_lower.get(normalizedFull.toLowerCase()) ??
      universe.by_full_lower.get(cleaned.toLowerCase());
    if (!match) return null;
    return {
      instrument: match,
      match_kind: "exact",
      confidence: 1,
      selection_reason: `Exact symbol match (${match.full_symbol}).`,
    };
  }

  const base = normalizeBaseSymbol(cleaned);
  const baseKeyUpper = base.toUpperCase();

  // Keep legacy behavior for default-listed assets.
  const defaultExact = universe.by_full_lower.get(base.toLowerCase());
  if (defaultExact && defaultExact.dex === "default") {
    return {
      instrument: defaultExact,
      match_kind: "exact",
      confidence: 1,
      selection_reason: `Exact default-dex match (${defaultExact.full_symbol}).`,
    };
  }

  const exactMatches = getSortedBaseMatches(universe, baseKeyUpper);
  if (exactMatches.length === 1) {
    return {
      instrument: exactMatches[0]!,
      match_kind: "exact",
      confidence: 0.99,
      selection_reason: `Exact symbol match (${exactMatches[0]!.full_symbol}).`,
    };
  }
  if (exactMatches.length > 1) {
    const selected = exactMatches[0]!;
    return {
      instrument: selected,
      match_kind: "exact",
      confidence: 0.92,
      selection_reason: `Matched ${exactMatches.length} venues; selected ${selected.full_symbol} by liquidity/leverage policy.`,
    };
  }

  // Alias path for sub-penny symbols (PEPE -> kPEPE).
  if (!baseKeyUpper.startsWith("K")) {
    const kMatches = getSortedBaseMatches(universe, `K${baseKeyUpper}`);
    if (kMatches.length > 0) {
      const selected = kMatches[0]!;
      return {
        instrument: selected,
        match_kind: "alias",
        confidence: 0.88,
        selection_reason: `Mapped ${base} to ${selected.base_symbol} via k-prefix alias.`,
      };
    }
  }

  if (opts.allow_prefix_match ?? true) {
    const prefixMatches = universe.instruments
      .filter((inst) => {
        const candidate = inst.base_symbol.toUpperCase();
        return candidate.startsWith(baseKeyUpper) && candidate !== baseKeyUpper;
      })
      .sort(compareByPolicy);

    if (prefixMatches.length > 0) {
      const selected = prefixMatches[0]!;
      return {
        instrument: selected,
        match_kind: "prefixed",
        confidence: 0.7,
        selection_reason: `Prefix match: ${base} -> ${selected.base_symbol}.`,
      };
    }
  }

  return null;
}

function scoreInstrumentForQuery(inst: HlInstrument, tokens: string[]): { score: number; reasons: string[] } {
  const fullLower = inst.full_symbol.toLowerCase();
  const baseUpper = inst.base_symbol.toUpperCase();
  const desc = (inst.instrument_description ?? "").toLowerCase();
  const tags = inst.theme_tags.map((t) => t.toLowerCase());

  let score = 0;
  let hasSemanticHit = false;
  const reasons: string[] = [];

  for (const token of tokens) {
    const tokenUpper = token.toUpperCase();
    if (baseUpper === tokenUpper || fullLower === token) {
      score += 8;
      hasSemanticHit = true;
      reasons.push(`exact token ${tokenUpper}`);
      continue;
    }
    if (baseUpper.includes(tokenUpper)) {
      score += 4;
      hasSemanticHit = true;
      reasons.push(`symbol contains ${tokenUpper}`);
    }
    if (fullLower.includes(token)) {
      score += 2;
      hasSemanticHit = true;
    }
    if (inst.dex === token) {
      score += 2;
      hasSemanticHit = true;
      reasons.push(`dex ${inst.dex}`);
    }
    if (inst.asset_class.toLowerCase().includes(token)) {
      score += 2;
      hasSemanticHit = true;
      reasons.push(`asset class ${inst.asset_class}`);
    }
    if (tags.some((tag) => tag.includes(token))) {
      score += 3;
      hasSemanticHit = true;
      reasons.push(`theme ${token}`);
    }
    if (desc.includes(token)) {
      score += 2;
      hasSemanticHit = true;
    }
  }

  if (tokens.length === 0 || hasSemanticHit) {
    if (inst.liquidity === "high") score += 1;
    if (inst.liquidity === "medium") score += 0.5;
  }

  return { score, reasons };
}

export function searchInstruments(universe: HlUniverse, query: string, limit = 5): HlQueryResult[] {
  const tokens = tokenizeQuery(query);
  const ranked = universe.instruments
    .map((inst) => {
      const { score, reasons } = scoreInstrumentForQuery(inst, tokens);
      return {
        instrument: inst,
        score,
        reasons,
      };
    })
    .filter((x) => x.score > 0 || tokens.length === 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return compareByPolicy(a.instrument, b.instrument);
    })
    .slice(0, limit);

  return ranked.map((item) => ({
    instrument: item.instrument,
    match_kind: "query",
    confidence: confidenceFromScore(item.score),
    selection_reason:
      item.reasons.length > 0
        ? `Query match via ${item.reasons.slice(0, 2).join(", ")}.`
        : "Query-ranked by liquidity and venue policy.",
    score: item.score,
  }));
}
