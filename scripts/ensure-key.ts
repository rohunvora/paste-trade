/**
 * Auto-provision paste.trade API key on first use.
 *
 * Checks for PASTE_TRADE_KEY in environment / .env file.
 * If missing, calls POST /api/keys to create a new user with
 * a random handle (e.g., CalmSwiftHeron) and saves the key.
 *
 * Returns: { apiKey, baseUrl } — ready to use for API calls.
 */

import { writeFileSync, existsSync, appendFileSync } from "fs";
import { getEnvSearchPaths, getPreferredEnvWritePath, readEnvValue } from "./runtime-paths";
import { normalizeTrustedBaseUrl } from "./security";

/** Read a key from process.env or the nearest user/project .env context. */
export function loadKey(key: string): string | undefined {
  return readEnvValue(key);
}

/** Resolve the base URL for paste.trade API. */
export function getBaseUrl(): string {
  const configured = loadKey("PASTE_TRADE_URL") || loadKey("BOARD_URL") || loadKey("BELIEF_BOARD_URL");
  const { baseUrl, trusted, reason } = normalizeTrustedBaseUrl(configured);
  if (!trusted && reason) {
    console.error(`[paste.trade] ${reason}`);
  }
  return baseUrl;
}

/**
 * Ensure a paste.trade API key exists. Auto-provisions if missing.
 * Returns the key string, or null if provisioning failed.
 */
export async function ensureKey(): Promise<string | null> {
  // Check for existing key
  const existing = loadKey("PASTE_TRADE_KEY");
  if (existing) return existing;

  // No key found — auto-provision
  const baseUrl = getBaseUrl();
  console.error(`[paste.trade] No API key found. Creating your identity...`);

  try {
    const res = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    if (!res.ok) {
      console.error(`[paste.trade] Failed to create API key. Run \`bun run scripts/onboard.ts\` to set up your account.`);
      return null;
    }

    const result = await res.json() as { api_key: string; user_id: string; handle: string };
    const { api_key, handle } = result;

    // Save to .env
    const saved = saveKeyToEnv(api_key);

    // Set for current process so subsequent calls don't re-provision
    process.env.PASTE_TRADE_KEY = api_key;

    // Tell the user who they are
    console.error(`[paste.trade] You are @${handle} · ${baseUrl.replace(/^https?:\/\//, '')}/u/${handle}`);
    if (saved) {
      console.error(`[paste.trade] Key saved to .env`);
    } else {
      console.error(`[paste.trade] Could not save to .env. Run \`bun run scripts/onboard.ts\` to set up your account.`);
    }

    return api_key;
  } catch (err) {
    console.error(`[paste.trade] Failed to create API key. Run \`bun run scripts/onboard.ts\` to set up your account.`);
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

/** Find candidate .env file paths, ordered by preference. */
function findEnvPaths(): string[] {
  return getEnvSearchPaths();
}

/** Append PASTE_TRADE_KEY to the best .env file. Returns true if saved. */
export function saveKeyToEnv(apiKey: string): boolean {
  const line = `\nPASTE_TRADE_KEY=${apiKey}\n`;

  // Try each candidate path — append to first one that exists
  for (const envPath of findEnvPaths()) {
    if (existsSync(envPath)) {
      try {
        appendFileSync(envPath, line);
        return true;
      } catch {
        // read-only or permission error — try next
      }
    }
  }

  const targetEnvPath = getPreferredEnvWritePath();
  try {
    if (existsSync(targetEnvPath)) {
      appendFileSync(targetEnvPath, line);
    } else {
      writeFileSync(targetEnvPath, `# paste.trade API key (auto-generated)\nPASTE_TRADE_KEY=${apiKey}\n`);
    }
    return true;
  } catch {
    return false;
  }
}
