#!/usr/bin/env bun
/**
 * Instrument discovery via paste.trade backend.
 *
 * Wraps POST /api/skill/discover to search for tradeable instruments
 * across all supported venues (Hyperliquid, Polymarket).
 *
 * Usage:
 *   bun run skill/scripts/discover.ts --catalog                     # HL non-crypto catalog
 *   bun run skill/scripts/discover.ts --query "defense spending"    # search all venues
 *   bun run skill/scripts/discover.ts --query "lakers" --platform polymarket
 */

import { applyRunId, extractRunIdArg } from "./run-id";
import { ensureKey, getBaseUrl, loadKey } from "./ensure-key";
import { streamLog } from "./stream-log";

const REQUEST_TIMEOUT_MS = Number(process.env.DISCOVER_BACKEND_TIMEOUT_MS || 30_000);

interface ParsedArgs {
  mode: "catalog" | "query";
  query?: string;
  platforms?: string[];
  assetClasses?: string[];
  runId?: string | null;
  thesisId?: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const { runId, args } = extractRunIdArg(argv);
  applyRunId(runId);

  let mode: "catalog" | "query" | null = null;
  let query: string | undefined;
  let thesisId: string | null = null;
  const platforms: string[] = [];
  const assetClasses: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--catalog") {
      mode = "catalog";
      continue;
    }
    if (args[i] === "--query" && args[i + 1]) {
      mode = "query";
      query = args[++i]!;
      continue;
    }
    if (args[i] === "--thesis-id" && args[i + 1]) {
      thesisId = args[++i]!;
      continue;
    }
    if (args[i] === "--platform" && args[i + 1]) {
      platforms.push(args[++i]!.toLowerCase());
      continue;
    }
    if (args[i] === "--asset-class" && args[i + 1]) {
      assetClasses.push(args[++i]!.toLowerCase());
      continue;
    }
  }

  if (!mode) {
    console.error("Usage: bun run skill/scripts/discover.ts [--run-id <runId>] <--catalog | --query \"keywords\">");
    console.error("Options:");
    console.error("  --catalog                    List all non-crypto HL instruments by asset class");
    console.error('  --query "keywords"           Search instruments across venues');
    console.error("  --platform NAME              Filter to specific platform (hyperliquid, polymarket)");
    console.error("  --asset-class NAME           Filter HL results (equity, index, commodity, fx, private_valuation)");
    process.exit(1);
  }

  return { mode, query, platforms: platforms.length > 0 ? platforms : undefined, assetClasses: assetClasses.length > 0 ? assetClasses : undefined, runId, thesisId };
}

async function getDiscoverAuth(): Promise<{ baseUrl: string; apiKey: string }> {
  const baseUrl = getBaseUrl();
  const existingKey = loadKey("PASTE_TRADE_KEY") || process.env.PASTE_TRADE_API_KEY?.trim();
  if (existingKey) {
    return { baseUrl, apiKey: existingKey };
  }

  const apiKey = await ensureKey();
  if (!apiKey) {
    throw new Error("PASTE_TRADE_KEY (or PASTE_TRADE_API_KEY) is required for discover.");
  }

  return { baseUrl, apiKey };
}

async function callBackendDiscover(parsed: ParsedArgs): Promise<unknown> {
  const { baseUrl, apiKey } = await getDiscoverAuth();

  const body: Record<string, unknown> = {};
  if (parsed.query) body.query = parsed.query;
  if (parsed.platforms) body.platforms = parsed.platforms;
  if (parsed.assetClasses) body.asset_classes = parsed.assetClasses;

  const response = await fetch(`${baseUrl}/api/skill/discover`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    let message = `Backend discover failed (${response.status})`;
    try {
      const errPayload = await response.json() as { error?: { message?: string } };
      if (errPayload?.error?.message) {
        message = `${message}: ${errPayload.error.message}`;
      }
    } catch {
      const text = await response.text().catch(() => "");
      if (text) message = `${message}: ${text}`;
    }
    throw new Error(message);
  }

  return await response.json();
}

async function main() {
  const parsed = parseArgs(process.argv);

  const logOpts = parsed.thesisId ? { thesisId: parsed.thesisId } : undefined;
  streamLog(`Searching instruments for "${parsed.query ?? "catalog"}"...`, logOpts);

  const result = await callBackendDiscover(parsed);

  // Stream what was found
  if (parsed.mode === "query") {
    const data = result as {
      hyperliquid?: { search_results?: Array<{ symbol?: string; description?: string }> };
      polymarket?: { markets?: Array<{ question?: string }> };
    };
    const hlResults = data.hyperliquid?.search_results ?? [];
    const pmResults = data.polymarket?.markets ?? [];
    const totalFound = hlResults.length + pmResults.length;

    if (totalFound > 0) {
      const parts: string[] = [];
      for (const r of hlResults.slice(0, 2)) {
        parts.push(r.symbol ?? "?");
      }
      for (const r of pmResults.slice(0, 2)) {
        parts.push(`"${(r.question ?? "?").slice(0, 50)}"`);
      }
      streamLog(`Found ${totalFound}: ${parts.join(", ")}`, logOpts);
    } else {
      streamLog(`No instruments found for "${parsed.query}"`, logOpts);
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
