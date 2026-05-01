/**
 * Shared mutable plugin state — dependency-injected to every module.
 * Mirror of Honcho's PluginState pattern.
 */
import { MnemosyneConfig } from "./config.js";
import Database from "better-sqlite3";
export interface PluginState {
    cfg: MnemosyneConfig;
    db: InstanceType<typeof Database>;
    initialized: boolean;
    ensureInitialized(): void;
    resolveDefaultAgentId(): string;
}
export declare function createPluginState(rawConfig: unknown): PluginState;
//# sourceMappingURL=state.d.ts.map