/**
 * Mnemosyne plugin configuration schema and validator.
 * Pure-JS validation — zero heavy deps so the plugin stays lightweight.
 */
const DEFAULT_NOISE = [
    "HEARTBEAT_OK",
    "cron reminder",
    "scheduled run",
    "[heartbeat]",
    "[system]",
];
function resolveDbPath(input) {
    const raw = typeof input === "string" && input.trim() ? input.trim() : "~/.openclaw/memory/mnemosyne.db";
    if (raw.startsWith("~/")) {
        const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
        return raw.replace("~/", `${home}/`);
    }
    return raw;
}
export function validateConfig(raw) {
    const cfg = (raw && typeof raw === "object") ? raw : {};
    const dbPath = resolveDbPath(cfg.dbPath);
    const ownerObserveOthers = cfg.ownerObserveOthers !== false;
    const rawNoise = Array.isArray(cfg.noisePatterns) ? cfg.noisePatterns.filter((s) => typeof s === "string") : [];
    const noisePatterns = [...DEFAULT_NOISE, ...rawNoise];
    const maxMessagesPerSession = Math.min(Math.max(Number(cfg.maxMessagesPerSession) || 10000, 100), 100000);
    const maxMemoriesPerSession = Math.min(Math.max(Number(cfg.maxMemoriesPerSession) || 1000, 10), 10000);
    const enableFts = cfg.enableFts !== false;
    return { dbPath, ownerObserveOthers, noisePatterns, maxMessagesPerSession, maxMemoriesPerSession, enableFts };
}
//# sourceMappingURL=config.js.map