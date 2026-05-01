/**
 * Shared mutable plugin state — dependency-injected to every module.
 * Mirror of Honcho's PluginState pattern.
 */
import { validateConfig } from "./config.js";
import { getDatabase } from "./database.js";
export function createPluginState(rawConfig) {
    const cfg = validateConfig(rawConfig);
    const db = getDatabase(cfg);
    const state = {
        cfg,
        db,
        initialized: false,
        ensureInitialized,
        resolveDefaultAgentId,
    };
    function resolveDefaultAgentId() {
        return "main";
    }
    function ensureInitialized() {
        if (state.initialized)
            return;
        state.initialized = true;
    }
    return state;
}
//# sourceMappingURL=state.js.map