import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import os from "os";
import { dirname, join, resolve } from "path";

const SCRIPTS_DIR = import.meta.dir;
export const SKILL_ROOT = resolve(SCRIPTS_DIR, "..");
const REPO_ROOT_CANDIDATE = resolve(SCRIPTS_DIR, "..", "..");

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((value) => resolve(value)))];
}

// Memoized: these only need to run once per process since cwd doesn't change mid-run.
let _gitRoot: string | null | undefined;
function getGitRootFromCwd(): string | null {
  if (_gitRoot !== undefined) return _gitRoot;
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    _gitRoot = gitRoot ? resolve(gitRoot) : null;
  } catch {
    _gitRoot = null;
  }
  return _gitRoot;
}

let _walkUpDirs: string[] | undefined;
function walkUpFromCwd(): string[] {
  if (_walkUpDirs) return _walkUpDirs;
  const homeDir = resolve(os.homedir());
  const dirs: string[] = [];
  let current = resolve(process.cwd());

  while (true) {
    dirs.push(current);
    if (current === homeDir) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  _walkUpDirs = dirs;
  return dirs;
}

export function isRepoCheckout(): boolean {
  return (
    existsSync(join(REPO_ROOT_CANDIDATE, "SKILL.md")) &&
    existsSync(join(REPO_ROOT_CANDIDATE, "skill", "scripts"))
  );
}

export function getRepoRoot(): string | null {
  return isRepoCheckout() ? REPO_ROOT_CANDIDATE : null;
}

export function getRuntimeDataDir(): string {
  const repoRoot = getRepoRoot();
  return repoRoot ? join(repoRoot, "data") : join(SKILL_ROOT, "data");
}

export function getRuntimeExtractionDir(): string {
  return join(getRuntimeDataDir(), "extractions");
}

export function getRuntimeSourceDir(): string {
  return join(getRuntimeDataDir(), "sources");
}

export function getUserStateDir(): string {
  const explicit = process.env.PASTE_TRADE_STATE_DIR?.trim();
  if (explicit) return explicit;

  const xdgState = process.env.XDG_STATE_HOME?.trim();
  if (xdgState) return join(xdgState, "paste-trade");

  return join(os.homedir(), ".paste-trade");
}

export function getEnvSearchPaths(): string[] {
  const envPaths: string[] = [];

  for (const dir of walkUpFromCwd()) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) envPaths.push(envPath);
  }

  const gitRoot = getGitRootFromCwd();
  if (gitRoot) {
    const gitEnvPath = join(gitRoot, ".env");
    if (existsSync(gitEnvPath)) envPaths.push(gitEnvPath);
  }

  const repoRoot = getRepoRoot();
  if (repoRoot) {
    const repoEnvPath = join(repoRoot, ".env");
    if (existsSync(repoEnvPath)) envPaths.push(repoEnvPath);
  }

  const skillEnvPath = join(SKILL_ROOT, ".env");
  if (existsSync(skillEnvPath)) envPaths.push(skillEnvPath);

  return uniquePaths(envPaths);
}

export function getPreferredEnvWritePath(): string {
  const existingPaths = getEnvSearchPaths();
  if (existingPaths.length > 0) return existingPaths[0];

  const gitRoot = getGitRootFromCwd();
  if (gitRoot) return join(gitRoot, ".env");

  return join(process.cwd(), ".env");
}

export function readEnvValue(key: string): string | undefined {
  const fromProcess = process.env[key];
  if (typeof fromProcess === "string" && fromProcess.trim()) {
    return fromProcess.trim();
  }

  for (const envPath of getEnvSearchPaths()) {
    try {
      const text = readFileSync(envPath, "utf8");
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const splitIndex = line.indexOf("=");
        if (splitIndex <= 0) continue;
        const envKey = line.slice(0, splitIndex).trim();
        if (envKey !== key) continue;
        const envValue = line.slice(splitIndex + 1).trim();
        if (!envValue) continue;
        return envValue.replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // Ignore unreadable .env files and continue.
    }
  }

  return undefined;
}
