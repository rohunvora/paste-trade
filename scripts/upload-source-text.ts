/**
 * Upload canonical full source text for a source.
 *
 * Usage:
 *   bun run skill/scripts/upload-source-text.ts <source_id> --file <path> [--provider transcript]
 *   bun run skill/scripts/upload-source-text.ts <source_id> '{"raw_text":"...","provider":"transcript"}'
 */

import { readFileSync } from "fs";
import { getAuthedBase, logHttp, readJsonInput, readResponseOrExit } from "./common";

const args = process.argv.slice(2);
const sourceId = (args[0] ?? "").trim();
if (!sourceId) {
  console.error("Usage: bun run skill/scripts/upload-source-text.ts <source_id> (--file <path> | '<JSON payload>')");
  process.exit(1);
}

let payload: { raw_text: string; provider?: string };
const fileIdx = args.findIndex((arg) => arg === "--file");
const providerIdx = args.findIndex((arg) => arg === "--provider");
const provider = providerIdx !== -1 ? (args[providerIdx + 1] ?? "").trim() : "";

if (fileIdx !== -1) {
  const filePath = (args[fileIdx + 1] ?? "").trim();
  if (!filePath) {
    console.error("[upload-source-text] --file requires a path");
    process.exit(1);
  }
  const rawText = readFileSync(filePath, "utf8");
  payload = {
    raw_text: rawText,
    provider: provider || "transcript_file",
  };
} else {
  const jsonArg = args[1] ?? "";
  const parsed = await readJsonInput(jsonArg);
  if (typeof parsed?.raw_text !== "string" || !parsed.raw_text.trim()) {
    console.error("[upload-source-text] payload requires non-empty raw_text");
    process.exit(1);
  }
  payload = {
    raw_text: parsed.raw_text,
    provider: (typeof parsed?.provider === "string" && parsed.provider.trim()) ? parsed.provider.trim() : (provider || undefined),
  };
}

const { baseUrl, headers } = await getAuthedBase();
const url = `${baseUrl}/api/sources/${encodeURIComponent(sourceId)}/source-text`;
logHttp("upload-source-text", "POST", url);
const res = await fetch(url, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});
console.log(await readResponseOrExit("upload-source-text", res));
