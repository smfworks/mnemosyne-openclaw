/**
 * Mnemosyne plugin configuration schema and validator.
 * Pure-JS validation — zero heavy deps so the plugin stays lightweight.
 */

export interface MnemosyneConfig {
  /** Full resolved path to the SQLite DB */
  dbPath: string;
  /** Whether to capture owner messages alongside agent messages */
  ownerObserveOthers: boolean;
  /** Substring patterns that cause a message to be skipped */
  noisePatterns: string[];
  /** Max messages per session before auto-pruning */
  maxMessagesPerSession: number;
  /** Max explicit memories per session before auto-pruning */
  maxMemoriesPerSession: number;
  /** Whether to enable FTS5 full-text search indexes (default: true) */
  enableFts: boolean;
}

const DEFAULT_NOISE = [
  "HEARTBEAT_OK",
  "cron reminder",
  "scheduled run",
  "[heartbeat]",
  "[system]",
];

function resolveDbPath(input: string | undefined): string {
  const raw = typeof input === "string" && input.trim() ? input.trim() : "~/.openclaw/memory/mnemosyne.db";
  if (raw.startsWith("~/")) {
    const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
    return raw.replace("~/", `${home}/`);
  }
  return raw;
}

export function validateConfig(raw: unknown): MnemosyneConfig {
  const cfg = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};

  const dbPath = resolveDbPath(cfg.dbPath as string);
  const ownerObserveOthers = cfg.ownerObserveOthers !== false;
  const rawNoise = Array.isArray(cfg.noisePatterns) ? cfg.noisePatterns.filter((s): s is string => typeof s === "string") : [];
  const noisePatterns = [...DEFAULT_NOISE, ...rawNoise];
  const maxMessagesPerSession = Math.min(
    Math.max(Number(cfg.maxMessagesPerSession) || 10000, 100),
    100000
  );
  const maxMemoriesPerSession = Math.min(
    Math.max(Number(cfg.maxMemoriesPerSession) || 1000, 10),
    10000
  );
  const enableFts = cfg.enableFts !== false;

  return { dbPath, ownerObserveOthers, noisePatterns, maxMessagesPerSession, maxMemoriesPerSession, enableFts };
}
