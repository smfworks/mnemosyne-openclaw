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
        const home = process.env.HOME || process.env.USERPROFILE;
        if (!home) {
            // Fail closed rather than dropping the memory DB (captured conversations +
            // memories) into a potentially world-readable /tmp on a misconfigured host.
            throw new Error("Mnemosyne: cannot expand '~' in dbPath — neither HOME nor USERPROFILE is set. Configure an absolute dbPath.");
        }
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
    const busyTimeoutMs = Math.min(Math.max(Number(cfg.busyTimeoutMs) || 5000, 100), 60000);
    return { dbPath, ownerObserveOthers, noisePatterns, maxMessagesPerSession, maxMemoriesPerSession, enableFts, busyTimeoutMs };
}
//# sourceMappingURL=config.js.map