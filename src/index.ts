/**
 * Mnemosyne — 100% offline, local SQLite memory plugin for OpenClaw.
 *
 * Exports a plain object matching OpenClaw's plugin entry contract.
 * OpenClaw loads this via the "extensions" field in package.json.
 */
import { createPluginState } from "./state.js";
import { onAgentEnd } from "./hooks/capture.js";
import {
  registerRememberTool,
  registerRecallTool,
  registerListTool,
  registerForgetTool,
  registerSearchTool,
} from "./tools/index.js";
import { ToolRuntimeContext } from "./types/runtime.js";

// Minimal API types used by this plugin
interface PluginApi {
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void };
  pluginConfig: unknown;
  on: (hook: string, handler: (...args: unknown[]) => void | Promise<void>, opts?: { priority?: number }) => void;
  registerTool: (factory: (ctx: ToolRuntimeContext) => Record<string, unknown>, opts?: { name?: string }) => void;
  registerCommand: (cmd: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    handler: (ctx: { args?: string; gatewayClientScopes?: string[] }) => Promise<{ text: string }> | { text: string };
  }) => void;
  registerMemoryPromptSupplement: (builder: () => string[]) => void;
  registerRuntimeLifecycle: (lifecycle: { id: string; onPluginUnload?: () => void }) => void;
}

let _state: ReturnType<typeof createPluginState> | null = null;

const pluginEntry = {
  id: "mnemosyne",
  name: "Mnemosyne (Offline Memory)",
  description:
    "100% offline, local SQLite memory plugin. Auto-captures conversations + explicit key-value storage with FTS5 full-text search.",
  kind: "memory" as const,

  register(api: PluginApi) {
    api.logger.info("[mnemosyne] Loading...");

    // 1. Initialize state (WAL checkpoint runs on startup)
    _state = createPluginState(api.pluginConfig);
    _state.ensureInitialized();

    // 2. Register agent_end hook — auto-capture every conversation turn
    api.on("agent_end", async (event, ctx) => {
      try {
        await onAgentEnd(
          event as { success: boolean; messages?: unknown[]; durationMs?: number },
          ctx as { sessionKey?: string; agentId?: string; runId?: string },
          _state!
        );
      } catch (err) {
        api.logger.error(`[mnemosyne] agent_end error: ${err}`);
      }
    });

    // 3. Register explicit memory tools — each factory receives runtime context
    api.registerTool((toolCtx: ToolRuntimeContext) => registerRememberTool(_state!, toolCtx), { name: "mnemosyne_remember" });
    api.registerTool((toolCtx: ToolRuntimeContext) => registerRecallTool(_state!, toolCtx),   { name: "mnemosyne_recall" });
    api.registerTool((toolCtx: ToolRuntimeContext) => registerSearchTool(_state!, toolCtx),   { name: "mnemosyne_search" });
    api.registerTool((toolCtx: ToolRuntimeContext) => registerListTool(_state!, toolCtx),     { name: "mnemosyne_list" });
    api.registerTool((toolCtx: ToolRuntimeContext) => registerForgetTool(_state!, toolCtx),   { name: "mnemosyne_forget" });

    // 4. Register /mnemosyne slash command
    api.registerCommand({
      name: "mnemosyne",
      description: "Mnemosyne offline memory status",
      acceptsArgs: true,
      handler: (ctx) => {
        const args = ctx.args?.trim().split(/\s+/) ?? [];
        const subcmd = args[0]?.toLowerCase();

        if (subcmd === "stats") {
          const msgRow = _state!.db.prepare(`SELECT COUNT(*) as c FROM messages`).get() as {c:number};
          const memRow = _state!.db.prepare(`SELECT COUNT(*) as c FROM memories`).get() as {c:number};
          const sessRow = _state!.db.prepare(`SELECT COUNT(*) as c FROM sessions`).get() as {c:number};
          return {
            text: `Mnemosyne Stats:\n- Messages: ${msgRow.c}\n- Memories: ${memRow.c}\n- Sessions: ${sessRow.c}\n- DB: ${_state!.cfg.dbPath}\n- FTS: ${_state!.cfg.enableFts ? "enabled" : "disabled"}`,
          };
        }

        return {
          text: `Mnemosyne (offline memory)\n- /mnemosyne stats — show counts\n- tools: mnemosyne_remember, mnemosyne_recall, mnemosyne_search, mnemosyne_list, mnemosyne_forget`,
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
    api.registerRuntimeLifecycle({
      id: "mnemosyne-lifecycle",
      onPluginUnload() {
        api.logger.info("[mnemosyne] Unloading...");
        import("./database.js").then(({ closeDatabase }) => {
          closeDatabase();
          _state = null;
        }).catch(() => {
          _state = null;
        });
      },
    });

    api.logger.info("[mnemosyne] Loaded successfully.");
  },
};

export default pluginEntry;
