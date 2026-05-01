/**
 * Mnemosyne SQLite database singleton.
 * Synchronous, WAL-mode, auto-vacuum. Zero network.
 * Includes FTS5 full-text search for cross-session semantic recall.
 */
import Database from "better-sqlite3";
import { MnemosyneConfig } from "./config.js";
export declare function getDatabase(cfg: MnemosyneConfig): InstanceType<typeof Database>;
export declare function closeDatabase(): void;
//# sourceMappingURL=database.d.ts.map