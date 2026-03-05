/**
 * Shared helpers for edit-mode adapter scripts.
 */

import { ensureKey, getBaseUrl } from "./ensure-key";

export async function getAuthedBase(): Promise<{ baseUrl: string; headers: Record<string, string> }> {
  const baseUrl = getBaseUrl();
  const apiKey = await ensureKey();
  if (!apiKey) {
    console.error("[edit] No API key found and auto-provision failed.");
    process.exit(1);
  }
  return {
    baseUrl,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  };
}

export async function readJsonInput(raw?: string): Promise<any> {
  let payload = raw ?? "";
  if (!payload.trim()) {
    payload = await Bun.stdin.text();
  }
  if (!payload.trim()) {
    console.error("[edit] Missing JSON payload.");
    process.exit(1);
  }
  try {
    return JSON.parse(payload);
  } catch {
    console.error(`[edit] Invalid JSON payload: ${payload.slice(0, 200)}`);
    process.exit(1);
  }
}

export function logHttp(tag: string, method: string, url: string): void {
  console.error(`[${tag}] ${method.toUpperCase()} ${url}`);
}

export async function readResponseOrExit(tag: string, res: Response): Promise<string> {
  const text = await res.text();
  if (!res.ok) {
    console.error(`[${tag}] Failed (${res.status}): ${text}`);
    process.exit(1);
  }
  return text;
}
