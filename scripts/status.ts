/**
 * Push a status event to a source page on paste.trade.
 * Used during live processing to show progress to viewers.
 *
 * Usage:
 *   bun run skill/scripts/status.ts '<source_id>' '<JSON event data>'
 *
 * Event data: { event_type, data: { message, step?, progress?, total?, ... } }
 *   event_type: "status" | "extraction_complete" | "thesis_found" | "trade_routed" | "complete" | "failed"
 *
 * Examples:
 *   bun run skill/scripts/status.ts 'abc123' '{ "event_type": "status", "data": { "message": "Extracting transcript..." } }'
 *   bun run skill/scripts/status.ts 'abc123' '{ "event_type": "thesis_found", "data": { "message": "Google zero profit in 2027", "progress": 1, "total": 5 } }'
 *   bun run skill/scripts/status.ts 'abc123' '{ "event_type": "complete", "data": { "message": "All trades posted", "source_theses": [...] } }'
 */

const sourceId = process.argv[2];
const eventPayload = process.argv[3];

if (!sourceId || !eventPayload) {
  console.error("Usage: bun run skill/scripts/status.ts '<source_id>' '<JSON event>'");
  process.exit(1);
}

let parsed: any;
try {
  parsed = JSON.parse(eventPayload);
} catch {
  console.error(`[status] Invalid JSON: ${eventPayload.slice(0, 200)}`);
  process.exit(1);
}

if (!parsed.event_type) {
  console.error("[status] Missing event_type in payload");
  process.exit(1);
}

// Shared env loading (key already provisioned by create-source.ts)
import { loadKey, getBaseUrl } from "./ensure-key";
const baseUrl = getBaseUrl();
const apiKey = loadKey("PASTE_TRADE_KEY");
console.error(`[status] POST to ${baseUrl}/api/sources/${sourceId}/events (${parsed.event_type})`);

const headers: Record<string, string> = { "Content-Type": "application/json" };
if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

const res = await fetch(`${baseUrl}/api/sources/${sourceId}/events`, {
  method: "POST",
  headers,
  body: JSON.stringify(parsed),
});

const text = await res.text();
if (!res.ok) {
  console.error(`[status] Failed (${res.status}): ${text}`);
  process.exit(1);
}

console.log(text);
