/**
 * /paste-connect — link your CLI account to your X identity on paste.trade.
 *
 * 1. Reads API key from .env
 * 2. Calls POST /api/connect/init → gets a short-lived connect URL
 * 3. Opens the URL in the default browser
 * 4. User signs into X → accounts merge automatically
 */

import { loadKey, getBaseUrl } from "./ensure-key";
import { execSync } from "child_process";

export async function connectAccount(): Promise<string> {
  const apiKey = loadKey("PASTE_TRADE_KEY");
  if (!apiKey) {
    return "No API key found. Run /trade first to create your account, then run /paste-connect to link it to your X profile.";
  }

  const baseUrl = getBaseUrl();

  // Call /api/connect/init to get a connect token
  const res = await fetch(`${baseUrl}/api/connect/init`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } })) as any;
    return `Failed to start connect flow: ${err?.error?.message ?? res.statusText}`;
  }

  const result = await res.json() as { connect_token: string; connect_url: string; expires_in: number };

  // Open the URL in the default browser
  const url = result.connect_url;
  try {
    if (process.platform === "darwin") {
      execSync(`open "${url}"`);
    } else if (process.platform === "linux") {
      execSync(`xdg-open "${url}"`);
    } else {
      execSync(`start "${url}"`);
    }
  } catch {
    // If open fails, the user can manually visit the URL
  }

  return [
    `Opening your browser to connect your X account...`,
    ``,
    `URL: ${url}`,
    `Expires in ${Math.floor(result.expires_in / 60)} minutes.`,
    ``,
    `Sign into X in the browser. Once complete, your CLI trades will appear on your paste.trade profile.`,
  ].join("\n");
}

// ── CLI entrypoint ──────────────────────────────────────────────────

if (import.meta.main) {
  connectAccount().then(msg => {
    console.log(msg);
  }).catch(err => {
    console.error("[paste-connect] Error:", err.message);
    process.exit(1);
  });
}
