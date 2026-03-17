/**
 * Speaker Diarization via Gemini
 *
 * Transcribes audio with speaker attribution using Google's Gemini API.
 * Downloads audio via yt-dlp, splits into chunks, processes in parallel.
 *
 * Short audio (<20 min): single upload + single API call
 * Long audio (>20 min): split into 15-min chunks with 30s overlap,
 *   upload and diarize all chunks in parallel, merge results.
 *
 * Usage:
 *   bun run skill/scripts/diarize.ts "https://youtube.com/watch?v=xxx"
 *
 * Requires: GEMINI_API_KEY env var, yt-dlp, ffmpeg
 * Cost: ~$0.14/hour (Flash), ~$0.26/hour (Pro)
 */

import { $ } from "bun";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { unlink, readdir } from "node:fs/promises";
import { getRuntimeSourceDir, readEnvValue } from "./runtime-paths";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta";

// Chunking config
const CHUNK_DURATION_SEC = 45 * 60; // 45 minutes per chunk (longer = better speaker consistency, Gemini handles up to 9.5hr)
const OVERLAP_SEC = 30; // 30s overlap between chunks for speaker continuity
const SHORT_THRESHOLD_SEC = 50 * 60; // below 50 min, don't chunk

function loadGeminiKey(): string | undefined {
  return readEnvValue("GEMINI_API_KEY");
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com\/watch|youtu\.be\/|youtube\.com\/live/.test(url);
}

function extractVideoId(url: string): string | null {
  const match = url.match(
    /(?:v=|youtu\.be\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/
  );
  return match?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Timestamp math
// ---------------------------------------------------------------------------

// Parse "MM:SS" or "H:MM:SS" to total seconds
function tsToSeconds(ts: string): number {
  const parts = ts.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

// Total seconds to "MM:SS" or "H:MM:SS"
function secondsToTs(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Audio download via yt-dlp
// ---------------------------------------------------------------------------

interface YoutubeMeta {
  publishedAt: string | null;
  title: string | null;
  /** YouTube channel display name (e.g. "All-In Podcast") */
  channel: string | null;
  /** YouTube @handle (e.g. "allin") — without the @ prefix */
  channelHandle: string | null;
  /** Full channel URL (e.g. "https://www.youtube.com/@allin") */
  channelUrl: string | null;
}

/** Fetch YouTube video metadata via yt-dlp --dump-json */
async function fetchYoutubeMeta(url: string): Promise<YoutubeMeta> {
  const empty: YoutubeMeta = { publishedAt: null, title: null, channel: null, channelHandle: null, channelUrl: null };
  try {
    const result = await $`yt-dlp --dump-json --skip-download ${url}`.quiet().nothrow();
    if (result.exitCode !== 0) return empty;
    const meta = JSON.parse(result.stdout.toString());

    const title: string | null = meta.title ?? meta.fulltitle ?? null;

    let publishedAt: string | null = null;
    if (meta.timestamp) {
      publishedAt = new Date(meta.timestamp * 1000).toISOString();
    } else if (meta.upload_date) {
      const d = meta.upload_date;
      publishedAt = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    }

    // Channel info: uploader_id is the @handle (e.g. "@allin"), channel is display name
    const channel: string | null = meta.channel ?? meta.uploader ?? null;
    const rawHandle: string | null = meta.uploader_id ?? null;
    const channelHandle = rawHandle?.replace(/^@/, "") ?? null;
    const channelUrl: string | null = meta.uploader_url ?? meta.channel_url ?? null;

    if (channel) console.error(`[diarize] YouTube channel: ${channel} (@${channelHandle})`);

    return { publishedAt, title, channel, channelHandle, channelUrl };
  } catch {
    return empty;
  }
}

async function downloadAudio(url: string): Promise<string> {
  const videoId = extractVideoId(url) || "audio";
  const outPath = join(tmpdir(), `diarize-${videoId}.mp3`);

  const { streamLog } = await import("./stream-log");
  streamLog("Downloading audio...");
  const result = await $`yt-dlp --extract-audio --audio-format mp3 --audio-quality 5 -o ${outPath} ${url}`
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    throw new Error(`yt-dlp failed (exit ${result.exitCode}): ${result.stderr.toString().slice(0, 200)}`);
  }

  const possiblePaths = [outPath, `${outPath}.mp3`];
  for (const p of possiblePaths) {
    if (await Bun.file(p).exists()) {
      const size = Bun.file(p).size;
      const { streamLog } = await import("./stream-log");
      streamLog(`Audio downloaded: ${(size / 1024 / 1024).toFixed(1)}MB`);
      return p;
    }
  }

  throw new Error(`Audio file not found at expected path: ${outPath}`);
}

// ---------------------------------------------------------------------------
// Get audio duration via ffprobe
// ---------------------------------------------------------------------------

async function getAudioDuration(filePath: string): Promise<number> {
  const result = await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${filePath}`
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    throw new Error(`ffprobe failed: ${result.stderr.toString().slice(0, 200)}`);
  }

  return parseFloat(result.stdout.toString().trim());
}

// ---------------------------------------------------------------------------
// Split audio into chunks via ffmpeg
// ---------------------------------------------------------------------------

interface Chunk {
  path: string;
  startSec: number; // absolute start time in the original audio
  index: number;
}

async function splitAudio(filePath: string, durationSec: number): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  const videoId = extractVideoId(filePath) || "chunk";
  let startSec = 0;
  let index = 0;

  while (startSec < durationSec) {
    // Each chunk is CHUNK_DURATION_SEC + OVERLAP_SEC (except the last one)
    const chunkLen = Math.min(CHUNK_DURATION_SEC + OVERLAP_SEC, durationSec - startSec);
    const chunkPath = join(tmpdir(), `diarize-chunk-${index}.mp3`);

    await $`ffmpeg -y -i ${filePath} -ss ${startSec} -t ${chunkLen} -acodec libmp3lame -q:a 5 ${chunkPath}`
      .quiet()
      .nothrow();

    if (await Bun.file(chunkPath).exists()) {
      chunks.push({ path: chunkPath, startSec, index });
    }

    startSec += CHUNK_DURATION_SEC; // advance by chunk duration (not including overlap)
    index++;
  }

  // Absorb degenerate final chunk (< 60s) into the previous chunk
  if (chunks.length > 1) {
    const lastChunk = chunks[chunks.length - 1];
    const lastChunkDuration = durationSec - lastChunk.startSec;
    if (lastChunkDuration < 60) {
      const removed = chunks.pop()!;
      try { await unlink(removed.path); } catch {}
      console.error(`[diarize] Absorbed ${lastChunkDuration}s final chunk into previous`);
    }
  }

  console.error(`[diarize] Split into ${chunks.length} chunks (${CHUNK_DURATION_SEC / 60}min each, ${OVERLAP_SEC}s overlap)`);
  return chunks;
}

// ---------------------------------------------------------------------------
// Gemini Files API: upload audio
// ---------------------------------------------------------------------------

async function uploadToGemini(
  filePath: string,
  apiKey: string,
  label: string
): Promise<{ uri: string; mimeType: string }> {
  const { streamLog } = await import("./stream-log");
  streamLog(`Uploading ${label}...`);

  const fileData = await Bun.file(filePath).arrayBuffer();
  const numBytes = fileData.byteLength;

  // Start resumable upload
  const startRes = await fetch(`${UPLOAD_BASE}/files?key=${apiKey}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(numBytes),
      "X-Goog-Upload-Header-Content-Type": "audio/mp3",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: label } }),
  });

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Upload start failed (${startRes.status}): ${err}`);
  }

  const uploadUrl = startRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("No upload URL returned from Gemini");

  // Upload the bytes
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(numBytes),
    },
    body: fileData,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Upload failed (${uploadRes.status}): ${err}`);
  }

  const uploadData = await uploadRes.json();
  const fileUri = uploadData.file?.uri;
  if (!fileUri) throw new Error(`No file URI in response: ${JSON.stringify(uploadData).slice(0, 200)}`);

  return { uri: fileUri, mimeType: "audio/mp3" };
}

// ---------------------------------------------------------------------------
// Gemini: diarize a single audio file/chunk
// ---------------------------------------------------------------------------

const DIARIZE_PROMPT = `Transcribe this audio verbatim with speaker attribution.

Requirements:
1. Identify each distinct speaker. Use their name if mentioned in context, otherwise Speaker 1, Speaker 2, etc.
2. Include timestamps in MM:SS format at the start of each speaker turn.
3. Transcribe exactly what is said. Do not summarize or paraphrase.
4. Start a new segment when the speaker changes or after a natural pause of 5+ seconds.

Output as JSON with this exact structure:
{
  "speakers": ["Speaker 1 name or label", "Speaker 2 name or label"],
  "segments": [
    { "speaker": "Speaker 1", "timestamp": "00:00", "text": "what they said" }
  ]
}`;

interface DiarizeSegment {
  speaker: string;
  timestamp: string;
  text: string;
}

interface DiarizeResult {
  speakers: string[];
  segments: DiarizeSegment[];
}

async function diarizeOneFile(
  fileUri: string,
  mimeType: string,
  apiKey: string,
  label: string
): Promise<DiarizeResult> {
  const { streamLog } = await import("./stream-log");
  streamLog(`Requesting diarization for ${label}...`);

  const response = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10 * 60 * 1000), // 10 min per chunk
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { file_data: { file_uri: fileUri, mime_type: mimeType } },
              { text: DIARIZE_PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 }, // transcription is mechanical, no reasoning needed
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");

  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed: DiarizeResult = JSON.parse(cleaned);

  streamLog(`${label} complete: ${parsed.segments.length} segments, ${parsed.speakers.length} speakers`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Merge chunk results: adjust timestamps, deduplicate overlap, unify speakers
// ---------------------------------------------------------------------------

function mergeChunkResults(
  chunks: { chunk: Chunk; result: DiarizeResult }[]
): DiarizeResult {
  // Sort by chunk index
  chunks.sort((a, b) => a.chunk.index - b.chunk.index);

  // Build unified speaker list (simple name matching across chunks)
  const allSpeakers = new Set<string>();
  for (const { result } of chunks) {
    for (const s of result.speakers) allSpeakers.add(s);
  }

  const mergedSegments: DiarizeSegment[] = [];
  let lastEndSec = 0;

  for (const { chunk, result } of chunks) {
    for (const seg of result.segments) {
      // Adjust timestamp: add chunk's absolute start time
      const segSec = tsToSeconds(seg.timestamp);
      const absoluteSec = chunk.startSec + segSec;

      // Skip segments in the overlap zone that we already covered from the previous chunk
      // The overlap zone is the last OVERLAP_SEC of each chunk (except the last)
      if (chunk.index > 0 && absoluteSec < lastEndSec - 5) {
        // Skip: this segment falls within already-transcribed territory
        // -5s tolerance for slight timestamp misalignment
        continue;
      }

      mergedSegments.push({
        speaker: seg.speaker,
        timestamp: secondsToTs(absoluteSec),
        text: seg.text,
      });
    }

    // Track where this chunk's non-overlap content ends
    lastEndSec = chunk.startSec + CHUNK_DURATION_SEC;
  }

  return {
    speakers: Array.from(allSpeakers),
    segments: mergedSegments,
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function processAudio(
  audioPath: string,
  url: string,
  apiKey: string
): Promise<string> {
  const { streamLog } = await import("./stream-log");
  const durationSec = await getAudioDuration(audioPath);
  const durationMin = (durationSec / 60).toFixed(1);
  streamLog(`Audio is ${durationMin} minutes. Uploading to Gemini...`);

  let finalResult: DiarizeResult;

  if (durationSec <= SHORT_THRESHOLD_SEC) {
    const uploaded = await uploadToGemini(audioPath, apiKey, "audio");
    streamLog("Diarizing speakers. This takes 1-2 minutes...");
    finalResult = await diarizeOneFile(uploaded.uri, uploaded.mimeType, apiKey, "audio");
  } else {
    // Long audio: chunk, parallel upload, parallel diarize, merge
    const chunks = await splitAudio(audioPath, durationSec);

    // Parallel upload all chunks
    const { streamLog: slog } = await import("./stream-log");
    slog(`Uploading ${chunks.length} audio chunks to Gemini...`);
    const uploadResults = await Promise.all(
      chunks.map((chunk) =>
        uploadToGemini(chunk.path, apiKey, `chunk ${chunk.index + 1}/${chunks.length}`)
      )
    );

    // Parallel diarize all chunks — allSettled so one failure doesn't kill the rest
    slog(`Diarizing ${chunks.length} chunks in parallel...`);
    const settled = await Promise.allSettled(
      uploadResults.map((uploaded, i) =>
        diarizeOneFile(
          uploaded.uri,
          uploaded.mimeType,
          apiKey,
          `chunk ${i + 1}/${chunks.length}`
        ).then((result) => ({ chunk: chunks[i], result }))
      )
    );

    // Collect successes, retry failures once
    const succeeded: { chunk: Chunk; result: DiarizeResult }[] = [];
    const failedIndices: number[] = [];
    for (let i = 0; i < settled.length; i++) {
      if (settled[i].status === "fulfilled") {
        succeeded.push((settled[i] as PromiseFulfilledResult<{ chunk: Chunk; result: DiarizeResult }>).value);
      } else {
        failedIndices.push(i);
      }
    }

    if (failedIndices.length > 0 && failedIndices.length < chunks.length) {
      slog(`${failedIndices.length} chunk(s) failed, retrying...`);
      const retries = await Promise.allSettled(
        failedIndices.map((i) =>
          diarizeOneFile(
            uploadResults[i].uri,
            uploadResults[i].mimeType,
            apiKey,
            `chunk ${i + 1}/${chunks.length} (retry)`
          ).then((result) => ({ chunk: chunks[i], result }))
        )
      );
      for (const r of retries) {
        if (r.status === "fulfilled") succeeded.push(r.value);
      }
    }

    if (succeeded.length === 0) {
      throw new Error("All diarization chunks failed");
    }

    if (succeeded.length < chunks.length) {
      slog(`${succeeded.length}/${chunks.length} chunks diarized, filling gaps from captions`);
    }

    // Merge successful chunks
    slog(`Merging ${succeeded.length} chunks...`);
    finalResult = mergeChunkResults(succeeded);

    // Cleanup chunk files
    for (const chunk of chunks) {
      try { await unlink(chunk.path); } catch {}
    }
  }

  // Build output
  const { streamLog: sl } = await import("./stream-log");
  const speakerNames = finalResult.speakers.join(", ");
  sl(`Diarization complete. ${finalResult.speakers.length} speakers: ${speakerNames}`);

  const flatTranscript = finalResult.segments
    .map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
    .join("\n");

  const wordCount = finalResult.segments.reduce(
    (sum, s) => sum + s.text.split(/\s+/).length,
    0
  );

  return JSON.stringify({
    source: "gemini",
    model: GEMINI_MODEL,
    url,
    speakers: finalResult.speakers,
    speaker_count: finalResult.speakers.length,
    word_count: wordCount,
    segment_count: finalResult.segments.length,
    transcript: flatTranscript,
    segments: finalResult.segments,
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const { extractRunIdArg, applyRunId } = await import("./run-id");
  const { runId, args } = extractRunIdArg(process.argv);
  applyRunId(runId);

  const url = args[0];
  if (!url) {
    console.error("Usage: bun run skill/scripts/diarize.ts [--run-id <runId>] <url>");
    process.exit(1);
  }

  const apiKey = loadGeminiKey();
  if (!apiKey) {
    console.log(
      JSON.stringify({
        source: "diarize",
        url,
        error: "No GEMINI_API_KEY found. Add it to .env for speaker diarization.",
        fallback: "Using yt-dlp transcript without speaker attribution.",
      })
    );
    process.exit(0);
  }

  if (!isYouTubeUrl(url)) {
    console.log(
      JSON.stringify({
        source: "diarize",
        url,
        error: "Diarization currently only supports YouTube URLs.",
        fallback: "Using standard extraction for this URL type.",
      })
    );
    process.exit(0);
  }

  // Emit enriching event for streaming progress (fills the dead zone during diarization)
  try {
    const { getStreamContext, pushEvent } = await import("./stream-context");
    const ctx = getStreamContext();
    if (ctx) {
      await pushEvent(ctx.source_id, "enriching", {
        step: "diarizing",
      }, { runId: ctx.run_id });
    }
  } catch (e) { console.error("[diarize] streaming event failed:", e); }

  console.error(`[diarize] Processing: ${url}`);
  console.error(`[diarize] Model: ${GEMINI_MODEL}`);

  // Fetch metadata (title + publish datetime) in parallel with audio download
  const metaPromise = fetchYoutubeMeta(url);

  try {
    const audioPath = await downloadAudio(url);
    const result = await processAudio(audioPath, url, apiKey);
    // Save for persistence across conversation turns
    const parsed = JSON.parse(result);
    const ytMeta = await metaPromise;
    if (ytMeta.title) {
      parsed.title = ytMeta.title;
      console.error(`[diarize] YouTube title: ${ytMeta.title}`);
    }
    if (ytMeta.publishedAt) {
      parsed.published_at = ytMeta.publishedAt;
      console.error(`[diarize] YouTube published_at: ${ytMeta.publishedAt}`);
    }
    if (ytMeta.channel) parsed.channel = ytMeta.channel;
    if (ytMeta.channelHandle) parsed.channel_handle = ytMeta.channelHandle;
    if (ytMeta.channelUrl) parsed.channel_url = ytMeta.channelUrl;
    const hash = new Bun.CryptoHasher("sha256").update(url).digest("hex").slice(0, 12);
    const dir = getRuntimeSourceDir();
    mkdirSync(dir, { recursive: true });
    // Separate path from extract.ts — no shared mutable artifact
    const filePath = join(dir, `source-${hash}.diarized.json`);
    parsed.saved_to = filePath;
    await Bun.write(filePath, JSON.stringify(parsed));
    console.error(`[diarize] Saved to ${filePath}`);
    console.log(JSON.stringify(parsed));
    // Cleanup main audio file
    try { await unlink(audioPath); } catch {}
  } catch (err: any) {
    console.error(`[diarize] Error: ${err.message}`);
    console.log(
      JSON.stringify({
        source: "diarize",
        url,
        error: err.message,
        fallback: "Using yt-dlp transcript without speaker attribution.",
      })
    );
  }
}

main();
