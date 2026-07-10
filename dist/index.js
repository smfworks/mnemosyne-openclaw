/**
 * Mnemosyne — 100% offline, local SQLite memory plugin for OpenClaw.
 *
 * Exports a plain object matching OpenClaw's plugin entry contract.
 * OpenClaw loads this via the "extensions" field in package.json.
 */
import { createPluginState } from "./state.js";
import { onAgentEnd } from "./hooks/capture.js";
import { closeDatabase } from "./database.js";
import { globalCounts } from "./dal.js";
import { registerRememberTool, registerRecallTool, registerListTool, registerForgetTool, registerSearchTool, } from "./tools/index.js";
let _state = null;
function sqliteQuickCheck() {
    const row = _state.db.prepare(`PRAGMA quick_check`).get();
    return row ? Object.values(row)[0] ?? "unknown" : "unknown";
}
const pluginEntry = {
    id: "mnemosyne",
    name: "Mnemosyne (Offline Memory)",
    description: "100% offline, local SQLite memory plugin. Auto-captures conversations + explicit key-value storage with FTS5 full-text search.",
    kind: "memory",
    register(api) {
        api.logger.info("[mnemosyne] Loading...");
        // 1. Initialize state (WAL checkpoint runs on startup)
        _state = createPluginState(api.pluginConfig);
        _state.ensureInitialized();
        // 2. Register agent_end hook — auto-capture every conversation turn
        api.on("agent_end", async (event, ctx) => {
            try {
                await onAgentEnd(event, ctx, _state);
            }
            catch (err) {
                api.logger.error(`[mnemosyne] agent_end error: ${err}`);
            }
        });
        // 3. Register explicit memory tools — each factory receives runtime context
        api.registerTool((toolCtx) => registerRememberTool(_state, toolCtx), { name: "mnemosyne_remember" });
        api.registerTool((toolCtx) => registerRecallTool(_state, toolCtx), { name: "mnemosyne_recall" });
        api.registerTool((toolCtx) => registerSearchTool(_state, toolCtx), { name: "mnemosyne_search" });
        api.registerTool((toolCtx) => registerListTool(_state, toolCtx), { name: "mnemosyne_list" });
        api.registerTool((toolCtx) => registerForgetTool(_state, toolCtx), { name: "mnemosyne_forget" });
        // 4. Register /mnemosyne slash command
        api.registerCommand({
            name: "mnemosyne",
            description: "Mnemosyne offline memory status",
            acceptsArgs: true,
            handler: (ctx) => {
                const args = ctx.args?.trim().split(/\s+/) ?? [];
                const subcmd = args[0]?.toLowerCase();
                // Authorization: an undefined scope list means a local/trusted invocation
                // (e.g. the CLI). A defined scope list means a gateway client — require an
                // explicit admin/owner scope before exposing maintenance actions or the
                // absolute DB path.
                const scopes = ctx.gatewayClientScopes;
                const trusted = !scopes || scopes.some((s) => s === "admin" || s === "owner" || s === "mnemosyne:admin");
                const dbDisplay = trusted ? _state.cfg.dbPath : (_state.cfg.dbPath.split(/[\\/]/).pop() ?? "mnemosyne.db");
                if (subcmd === "stats") {
                    const counts = globalCounts(_state);
                    const integrity = sqliteQuickCheck();
                    return {
                        text: `Mnemosyne Stats:\n- Messages: ${counts.messages}\n- Memories: ${counts.memories}\n- Sessions: ${counts.sessions}\n- DB: ${dbDisplay}\n- FTS: ${_state.cfg.enableFts ? "enabled" : "disabled"}\n- SQLite quick_check: ${integrity}`,
                    };
                }
                if (subcmd === "health") {
                    if (!trusted)
                        return { text: "Mnemosyne: 'health' requires an admin/owner scope." };
                    const integrity = sqliteQuickCheck();
                    const wal = _state.db.pragma("wal_checkpoint(PASSIVE)");
                    return {
                        text: `Mnemosyne Health:\n- SQLite quick_check: ${integrity}\n- WAL checkpoint: ${JSON.stringify(wal)}\n- DB: ${dbDisplay}`,
                    };
                }
                if (subcmd === "vacuum") {
                    if (!trusted)
                        return { text: "Mnemosyne: 'vacuum' requires an admin/owner scope." };
                    _state.db.pragma("incremental_vacuum");
                    _state.db.pragma("wal_checkpoint(TRUNCATE)");
                    return {
                        text: "Mnemosyne maintenance complete: incremental_vacuum and WAL checkpoint(TRUNCATE) finished.",
                    };
                }
                return {
                    text: `Mnemosyne (offline memory)\n- /mnemosyne stats — show counts and quick_check\n- /mnemosyne health — quick_check plus passive WAL checkpoint\n- /mnemosyne vacuum — incremental vacuum plus WAL truncate checkpoint\n- tools: mnemosyne_remember, mnemosyne_recall, mnemosyne_search, mnemosyne_list, mnemosyne_forget`,
                };
            },
        });
        // 5. Register memory prompt supplement
        api.registerMemoryPromptSupplement(() => {
            return [
                "## Mnemosyne Memory",
                "You have access to your local memory store via tools:",
                "- mnemosyne_remember — store a key-value fact for this session",
                "- mnemosyne_recall — retrieve a stored fact by key, query, or cross-session",
                "- mnemosyne_search — full-text search across ALL past conversations (FTS5)",
                "- mnemosyne_list — list all stored memories for this session",
                "- mnemosyne_forget — delete a memory by key",
                "",
                "Use mnemosyne_search to find past conversations about any topic.",
                "Use mnemosyne_recall(cross_session=true) to look up facts from earlier sessions.",
                "Your conversation history is automatically captured. You do not need to call tools for that.",
            ];
        });
        // 6. Register lifecycle hooks (id required for validation)
        const thisInstance = _state;
        api.registerRuntimeLifecycle({
            id: "mnemosyne-lifecycle",
            onPluginUnload() {
                api.logger.info("[mnemosyne] Unloading...");
                try {
                    closeDatabase();
                }
                catch (err) {
                    api.logger.error(`[mnemosyne] close error: ${err}`);
                }
                // Only clear global state if it still points at THIS instance, so a
                // concurrent reload that already installed a newer state isn't clobbered.
                if (_state === thisInstance) {
                    _state = null;
                }
            },
        });
        api.logger.info("[mnemosyne] Loaded successfully.");
    },
};
export default pluginEntry;
//# sourceMappingURL=index.js.map