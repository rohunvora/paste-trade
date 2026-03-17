#!/usr/bin/env bun
/**
 * Source context retrieval for routing.
 *
 * Searches the locally saved source file for passages relevant to a thesis.
 * Gives routing workers access to surrounding context that was lost after
 * extraction split the source into individual theses.
 *
 * Two modes:
 *   --query "keywords"   Keyword search, returns top passages ranked by relevance
 *   --around "exact quote"  Returns ~500 words surrounding an exact quote match
 *
 * Usage:
 *   bun run skill/scripts/source-excerpt.ts --file <saved_to> --query "compute NVIDIA OpenAI"
 *   bun run skill/scripts/source-excerpt.ts --file <saved_to> --around "who has the most compute"
 */

import { readFileSync } from "fs";
import { applyRunId, extractRunIdArg } from "./run-id";
import { getStreamContext, pushEvent } from "./stream-context";

// ── Args ──────────────────────────────────────────────────────────

interface ParsedArgs {
  file: string;
  mode: "query" | "around";
  text: string;
  maxPassages: number;
  windowWords: number;
  thesisId?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  let file = "";
  let mode: "query" | "around" | null = null;
  let text = "";
  let maxPassages = 5;
  let windowWords = 150;
  let thesisId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" && argv[i + 1]) { file = argv[++i]!; continue; }
    if (argv[i] === "--query" && argv[i + 1]) { mode = "query"; text = argv[++i]!; continue; }
    if (argv[i] === "--around" && argv[i + 1]) { mode = "around"; text = argv[++i]!; continue; }
    if (argv[i] === "--thesis-id" && argv[i + 1]) { thesisId = argv[++i]!; continue; }
    if (argv[i] === "--max" && argv[i + 1]) { maxPassages = parseInt(argv[++i]!, 10); continue; }
    if (argv[i] === "--window" && argv[i + 1]) { windowWords = parseInt(argv[++i]!, 10); continue; }
  }

  if (!file || !mode || !text) {
    console.error("Usage: bun run skill/scripts/source-excerpt.ts --file <path> <--query \"keywords\" | --around \"exact quote\">");
    console.error("Options:");
    console.error("  --max N        Max passages to return (default: 5)");
    console.error("  --window N     Words per passage window (default: 150)");
    process.exit(1);
  }

  return { file, mode, text, maxPassages, windowWords, thesisId };
}

// ── Source loading ────────────────────────────────────────────────

function loadSourceText(filePath: string): string {
  const raw = readFileSync(filePath, "utf8");
  // Source files are JSON with a "transcript" or "text" field
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.transcript === "string") return parsed.transcript;
    if (typeof parsed.text === "string") return parsed.text;
    if (typeof parsed.source_text === "string") return parsed.source_text;
    // If none of those fields, treat the whole file as text
    return raw;
  } catch {
    // Not JSON — treat as plain text
    return raw;
  }
}

// ── Tokenization ─────────────────────────────────────────────────

/** Split text into words, preserving position info. */
function tokenize(text: string): Array<{ word: string; start: number; end: number }> {
  const tokens: Array<{ word: string; start: number; end: number }> = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    tokens.push({ word: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/** Stopwords to skip in keyword scoring. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "was", "be", "are", "been",
  "has", "have", "had", "will", "would", "could", "should", "that",
  "this", "these", "those", "not", "no", "so", "if", "as", "about",
  "into", "than", "its", "they", "them", "their", "he", "she", "his",
  "her", "we", "our", "you", "your", "i", "my", "me", "do", "did",
  "does", "very", "just", "also", "more", "most", "much", "many",
  "some", "all", "any", "each", "every", "up", "out", "can", "what",
  "when", "where", "how", "which", "who", "whom", "why",
]);

// ── Query mode ───────────────────────────────────────────────────

interface Passage {
  text: string;
  start: number;
  end: number;
  score: number;
}

function querySearch(
  sourceText: string,
  query: string,
  maxPassages: number,
  windowWords: number,
): Passage[] {
  const queryTerms = query
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length >= 2 && !STOP.has(t));

  if (queryTerms.length === 0) return [];

  const tokens = tokenize(sourceText);
  const halfWindow = Math.floor(windowWords / 2);

  // Score each window position
  const scored: Array<{ center: number; score: number }> = [];

  for (let center = 0; center < tokens.length; center += 10) {
    const windowStart = Math.max(0, center - halfWindow);
    const windowEnd = Math.min(tokens.length - 1, center + halfWindow);

    // Collect words in this window
    const windowText = tokens
      .slice(windowStart, windowEnd + 1)
      .map(t => t.word.toLowerCase().replace(/[^a-z0-9]/g, ""))
      .join(" ");

    // Score: count of query terms present + bonus for adjacency
    let score = 0;
    const matched = new Set<string>();
    for (const term of queryTerms) {
      if (windowText.includes(term)) {
        score += 1;
        matched.add(term);
      }
    }

    // Coverage bonus: all terms present in one window
    if (matched.size === queryTerms.length) {
      score += queryTerms.length;
    }

    if (score > 0) {
      scored.push({ center, score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Deduplicate overlapping passages
  const passages: Passage[] = [];
  const usedRanges: Array<[number, number]> = [];

  for (const { center, score } of scored) {
    if (passages.length >= maxPassages) break;

    const windowStart = Math.max(0, center - halfWindow);
    const windowEnd = Math.min(tokens.length - 1, center + halfWindow);

    // Skip if overlapping with an already-selected passage
    const overlaps = usedRanges.some(
      ([s, e]) => windowStart <= e && windowEnd >= s,
    );
    if (overlaps) continue;

    usedRanges.push([windowStart, windowEnd]);

    const charStart = tokens[windowStart]!.start;
    const charEnd = tokens[windowEnd]!.end;
    const passageText = sourceText.slice(charStart, charEnd);
    const maxScore = queryTerms.length * 2; // max possible

    passages.push({
      text: passageText,
      start: charStart,
      end: charEnd,
      score: Math.round((score / maxScore) * 100) / 100,
    });
  }

  return passages;
}

// ── Around mode ──────────────────────────────────────────────────

function aroundSearch(
  sourceText: string,
  exactQuote: string,
  windowWords: number,
): Passage[] {
  const lowerSource = sourceText.toLowerCase();
  const lowerQuote = exactQuote.toLowerCase();

  const idx = lowerSource.indexOf(lowerQuote);
  if (idx === -1) {
    // Fallback: try matching by longest substring
    const words = lowerQuote.split(/\s+/).filter(w => w.length >= 3);
    if (words.length >= 3) {
      // Try the first 5 significant words as a query search
      return querySearch(sourceText, words.slice(0, 5).join(" "), 1, windowWords * 2);
    }
    return [];
  }

  // Found exact match — expand to windowWords around it
  const tokens = tokenize(sourceText);
  const quoteEnd = idx + exactQuote.length;

  // Find the token indices that contain the quote
  let startTokenIdx = 0;
  let endTokenIdx = tokens.length - 1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.start <= idx) startTokenIdx = i;
    if (tokens[i]!.end >= quoteEnd) { endTokenIdx = i; break; }
  }

  // Expand window
  const halfExpand = Math.floor(windowWords / 2);
  const windowStart = Math.max(0, startTokenIdx - halfExpand);
  const windowEnd = Math.min(tokens.length - 1, endTokenIdx + halfExpand);

  const charStart = tokens[windowStart]!.start;
  const charEnd = tokens[windowEnd]!.end;

  return [{
    text: sourceText.slice(charStart, charEnd),
    start: charStart,
    end: charEnd,
    score: 1.0,
  }];
}

// ── Main ─────────────────────────────────────────────────────────

const { runId, args: rawArgs } = extractRunIdArg(process.argv);
applyRunId(runId);

const args = parseArgs(rawArgs);
const sourceText = loadSourceText(args.file);

if (!sourceText.trim()) {
  console.error("[source-excerpt] Source file is empty or unreadable");
  process.exit(1);
}

const passages = args.mode === "query"
  ? querySearch(sourceText, args.text, args.maxPassages, args.windowWords)
  : aroundSearch(sourceText, args.text, args.windowWords);

const result = {
  mode: args.mode,
  [args.mode === "query" ? "query" : "around"]: args.text,
  passages,
  source_file: args.file,
  source_words: sourceText.split(/\s+/).length,
};

// Stream progress event
if (passages.length > 0) {
  const { streamLog } = await import("./stream-log");
  const preview = passages[0]!.text.slice(0, 80).replace(/\n/g, " ");
  const label = args.mode === "query" ? args.text : `"${args.text}"`;
  streamLog(`Context recovered for ${label}: "${preview}..."`, args.thesisId ? { thesisId: args.thesisId } : undefined);
}

console.log(JSON.stringify(result, null, 2));
