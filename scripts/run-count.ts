import { existsSync } from "fs";
import { getRuntimeExtractionDir } from "./runtime-paths";

const DEFAULT_EXTRACTION_DIR = getRuntimeExtractionDir();

interface RunCountOptions {
  extractionDir?: string;
}

export async function countRunExtractions(runId: string | null | undefined, opts: RunCountOptions = {}): Promise<number | null> {
  const normalizedRunId = typeof runId === "string" ? runId.trim() : "";
  if (!normalizedRunId) {
    return null;
  }

  const extractionDir = opts.extractionDir ?? DEFAULT_EXTRACTION_DIR;
  if (!existsSync(extractionDir)) {
    return 0;
  }

  const files = (await Array.fromAsync(new Bun.Glob("extraction-*.jsonl").scan(extractionDir)))
    .map((file) => `${extractionDir}/${file}`)
    .sort();

  let count = 0;
  for (const file of files) {
    const content = await Bun.file(file).text();
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { run_id?: string; id?: string };
        if (parsed.run_id === normalizedRunId && typeof parsed.id === "string" && parsed.id.trim()) {
          count += 1;
        }
      } catch {
        // Skip malformed JSONL lines.
      }
    }
  }

  return count;
}
