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
export declare function validateConfig(raw: unknown): MnemosyneConfig;
//# sourceMappingURL=config.d.ts.map