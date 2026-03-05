/**
 * Auto-provision paste.trade API key on first use.
 *
 * Checks for PASTE_TRADE_KEY in environment / .env file.
 * If missing, calls POST /api/keys to create a new user with
 * a random handle (e.g., CalmSwiftHeron) and saves the key.
 *
 * Returns: { apiKey, baseUrl } — ready to use for API calls.
 */

import { join } from "path";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { execSync } from "child_process";

/** Read a key from process.env or the repo-root .env file. */
export function loadKey(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  for (const envPath of findEnvPaths()) {
    try {
      const text = readFileSync(envPath, "utf8");
      const match = text.match(new RegExp(`^${key}=(.+)$`, "m"));
      if (match) return match[1].trim();
    } catch { /* file doesn't exist or unreadable */ }
  }
  return undefined;
}

/** Resolve the base URL for paste.trade API. */
export function getBaseUrl(): string {
  return loadKey("PASTE_TRADE_URL") || loadKey("BOARD_URL") || loadKey("BELIEF_BOARD_URL") || "https://paste.trade";
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
      const errText = await res.text();
      console.error(`[paste.trade] Failed to create key (${res.status}): ${errText}`);
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
      console.error(`[paste.trade] Could not save to .env — add manually: PASTE_TRADE_KEY=${api_key}`);
    }

    return api_key;
  } catch (err) {
    console.error(`[paste.trade] Network error creating key:`, (err as Error).message);
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

/** Find candidate .env file paths, ordered by preference. */
function findEnvPaths(): string[] {
  const paths: string[] = [];

  // 1. Repo root (relative to this file: scripts/ -> skill-v2-lab/ -> skill-dev/ -> repo root)
  paths.push(join(import.meta.dir, "..", "..", "..", ".env"));

  // 2. Git root (handles cases where cwd differs from repo root)
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    const gitEnv = join(gitRoot, ".env");
    if (!paths.includes(gitEnv)) paths.push(gitEnv);
  } catch { /* not in a git repo */ }

  // 3. Current working directory
  const cwdEnv = join(process.cwd(), ".env");
  if (!paths.includes(cwdEnv)) paths.push(cwdEnv);

  return paths;
}

/** Append PASTE_TRADE_KEY to the best .env file. Returns true if saved. */
function saveKeyToEnv(apiKey: string): boolean {
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

  // No existing .env found — create one at repo root (first candidate)
  const paths = findEnvPaths();
  if (paths.length > 0) {
    try {
      writeFileSync(paths[0], `# paste.trade API key (auto-generated)\nPASTE_TRADE_KEY=${apiKey}\n`);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
