/**
 * Mnemosyne explicit memory tools.
 * These are exposed to the agent as callable tools, separate from automatic capture.
 *
 * Each tool factory receives the OpenClaw runtime context (sessionKey, agentId, sandboxed)
 * so that memories are scoped to the actual session, not a hardcoded default.
 *
 * These tools issue NO SQL directly: all content-table access goes through a
 * {@link ScopedStore} (see src/dal.ts), which binds every query to the caller's
 * agent/session. That keeps cross-agent isolation a structural property instead
 * of a per-query convention that a future edit could forget.
 */
import { PluginState } from "../state.js";
import { ToolRuntimeContext } from "../types/runtime.js";
import { ScopedStore, MemoryScope, ForgetScope } from "../dal.js";
import { withRetry, sleepSync, isBusyError } from "../retry.js";

// ── Input validation constants ──

/** Maximum length for a memory key (after normalization). */
const MAX_KEY_LENGTH = 256;
/** Maximum length for a memory value. */
const MAX_VALUE_LENGTH = 16384;
/** Maximum length for a search query. */
const MAX_QUERY_LENGTH = 1024;
/** Maximum length for an agent ID or session key. */
const MAX_ID_LENGTH = 512;

// ── Error guards ──
// (sleepSync, isBusyError, withRetry moved to src/retry.ts)

/**
 * Wrap a tool's execute function with structured error handling.
 * Translates raw DB errors into user-friendly tool responses instead of
 * propagating unstructured exceptions to the agent runtime.
 */
function withErrorHandling(
  fn: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>,
  toolName: string
): (toolCallId: string, params: Record<string, unknown>) => Promise<unknown> {
  return async (toolCallId: string, params: Record<string, unknown>) => {
    try {
      return await fn(toolCallId, params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error in ${toolName}: ${message}` }],
        isError: true,
        details: { error: message },
      };
    }
  };
}

// ── Resolve session key ──

function resolveSessionKey(toolCtx: ToolRuntimeContext): string {
  if (toolCtx.sessionKey) {
    const sk = String(toolCtx.sessionKey);
    if (sk.length > MAX_ID_LENGTH) {
      throw new Error(`sessionKey exceeds maximum length of ${MAX_ID_LENGTH} characters`);
    }
    return sk;
  }
  const sessionId = typeof toolCtx.sessionId === "string" ? toolCtx.sessionId : undefined;
  if (sessionId) {
    if (sessionId.length > MAX_ID_LENGTH) {
      throw new Error(`sessionId exceeds maximum length of ${MAX_ID_LENGTH} characters`);
    }
    return sessionId;
  }
  return `agent_${toolCtx.agentId ?? "main"}_default`;
}

function resolveAgentId(toolCtx: ToolRuntimeContext): string {
  const agentId = toolCtx.agentId ?? "main";
  if (agentId.length > MAX_ID_LENGTH) {
    throw new Error(`agentId exceeds maximum length of ${MAX_ID_LENGTH} characters`);
  }
  return agentId;
}

function storeFor(state: PluginState, toolCtx: ToolRuntimeContext): ScopedStore {
  return new ScopedStore(state, resolveAgentId(toolCtx), resolveSessionKey(toolCtx));
}

function normalizeKey(input: unknown): string {
  return String(input ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function clampInt(input: unknown, fallback: number, min: number, max: number): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * Validate and clamp a string parameter to a maximum length.
 * Returns the trimmed string or throws if it exceeds the limit.
 */
function validateStringParam(value: unknown, name: string, maxLength: number): string {
  const str = String(value ?? "").trim();
  if (str.length > maxLength) {
    throw new Error(`Parameter '${name}' exceeds maximum length of ${maxLength} characters`);
  }
  return str;
}

// ═══════════════════════════════════════════
// mnemosyne_remember
// ═══════════════════════════════════════════

export function registerRememberTool(state: PluginState, toolCtx: ToolRuntimeContext) {
  return {
    name: "mnemosyne_remember",
    label: "Mnemosyne Remember",
    description: `Store an explicit key-value memory for the current session.

Use this when the user shares a fact, preference, or directive you should recall later.
The memory is scoped to the current session and persisted locally in SQLite.

Examples:
- {"key": "user_name", "value": "Michael"}
- {"key": "timezone", "value": "America/New_York"}
- {"key": "project_active", "value": "building Mnemosyne plugin"}
`,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        key: {
          type: "string",
          description: "Short identifier for this memory (e.g. 'user_name', 'goal', 'preference_voice')",
        },
        value: {
          type: "string",
          description: "The value to store. Be concise but complete.",
        },
        scope: {
          type: "string",
          enum: ["session", "agent"],
          default: "session",
          description: "'session' = only this conversation. 'agent' = all conversations for this agent.",
        },
      },
      required: ["key", "value"],
    },
    execute: withErrorHandling(async (_toolCallId: string, params: Record<string, unknown>) => {
      const key = normalizeKey(params.key);
      const value = validateStringParam(params.value, "value", MAX_VALUE_LENGTH);
      const scope: MemoryScope = params.scope === "agent" ? "agent" : "session";
      if (!key) {
        throw new Error("mnemosyne_remember requires 'key'");
      }
      if (key.length > MAX_KEY_LENGTH) {
        throw new Error(`mnemosyne_remember: key exceeds maximum length of ${MAX_KEY_LENGTH} characters`);
      }
      if (!value) {
        throw new Error("mnemosyne_remember requires 'value'");
      }

      const store = storeFor(state, toolCtx);
      return withRetry(() => {
        store.rememberMemory(scope, key, value);
        return {
          content: [{ type: "text", text: `Remembered: ${key} = ${value} (${scope})` }],
          details: { key, value, scope },
        };
      });
    }, "mnemosyne_remember"),
  };
}

// ═══════════════════════════════════════════
// mnemosyne_recall
// ═══════════════════════════════════════════

export function registerRecallTool(state: PluginState, toolCtx: ToolRuntimeContext) {
  return {
    name: "mnemosyne_recall",
    label: "Mnemosyne Recall",
    description: `Recall explicit memories by key or search query.

Use this when you need to retrieve a stored fact, preference, or directive.
Returns matching memories ordered by recency.

Examples:
- {"key": "user_name"} → "Michael"
- {"query": "timezone"} → memories with 'timezone' in key or value
- {"query": "memory", "cross_session": true} → search ALL sessions
`,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        key: {
          type: "string",
          description: "Exact key to look up (e.g. 'user_name'). If omitted, 'query' is used.",
        },
        query: {
          type: "string",
          description: "Search term for fuzzy key/value matching. Used if 'key' is not provided.",
        },
        cross_session: {
          type: "boolean",
          default: false,
          description: "If true, search across all sessions (not just the current one).",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 5,
          description: "Max results to return",
        },
      },
      required: [],
    },
    execute: withErrorHandling(async (_toolCallId: string, params: Record<string, unknown>) => {
      const key = normalizeKey(params.key);
      const query = validateStringParam(params.query, "query", MAX_QUERY_LENGTH).toLowerCase();
      const crossSession = Boolean(params.cross_session);
      const limit = clampInt(params.limit, 5, 1, 50);

      if (key.length > MAX_KEY_LENGTH) {
        throw new Error(`mnemosyne_recall: key exceeds maximum length of ${MAX_KEY_LENGTH} characters`);
      }

      const store = storeFor(state, toolCtx);
      return withRetry(() => {
        const rows = store.recall({
          key: key || undefined,
          query: query || undefined,
          crossSession,
          limit,
        });

        if (rows.length === 0) {
          return {
            content: [{ type: "text", text: "No memories found." }],
            details: { count: 0 },
          };
        }

        const lines = rows.map(
          (r) => `- ${r.key}: ${r.value} (${store.scopeOf(r.session_key)}${crossSession ? `, session: ${r.session_key.slice(0, 20)}…` : ""})`
        );

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { count: rows.length, keys: rows.map((r) => r.key) },
        };
      });
    }, "mnemosyne_recall"),
  };
}

// ═══════════════════════════════════════════
// mnemosyne_search (FTS5 full-text)
// ═══════════════════════════════════════════

export function registerSearchTool(state: PluginState, toolCtx: ToolRuntimeContext) {
  return {
    name: "mnemosyne_search",
    label: "Mnemosyne Search",
    description: `Full-text search across all captured conversations and explicit memories.

Uses SQLite FTS5 with stemming — finds related words (e.g. "remember" matches "remembering", "remembered").
Search ALL sessions, not just the current one. This is your "what was said about X?" tool.

Parameters:
- query (string, required): Natural-language search. Multi-word queries use AND by default.
- source (string): "messages" (conversation turns), "memories" (explicit key-value), or "all" (both). Default: "all"
- limit (integer, 1-50): Max results. Default: 10
`,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g. 'wine candles', 'memory plugin', 'user preference')",
        },
        source: {
          type: "string",
          enum: ["messages", "memories", "all"],
          default: "all",
          description: "What to search: conversation turns, explicit memories, or both",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
          description: "Max results",
        },
      },
      required: ["query"],
    },
    execute: withErrorHandling(async (_toolCallId: string, params: Record<string, unknown>) => {
      const query = validateStringParam(params.query, "query", MAX_QUERY_LENGTH);
      if (!query) {
        throw new Error("mnemosyne_search requires 'query'");
      }
      const source = (params.source === "messages" || params.source === "memories") ? params.source : "all";
      const limit = clampInt(params.limit, 10, 1, 50);

      const store = storeFor(state, toolCtx);
      return withRetry(() => {
        const trimmed = store.search({ query, source, limit });

        if (trimmed.length === 0) {
          return {
            content: [{ type: "text", text: `No results found for "${query}".` }],
            details: { count: 0, query },
          };
        }

        const lines = trimmed.map((r) => `[${r.source}] ${r.text} (session: ${r.session}…)`);
        return {
          content: [{ type: "text", text: `Search results for "${query}":\n\n${lines.join("\n\n")}` }],
          details: { count: trimmed.length, query },
        };
      });
    }, "mnemosyne_search"),
  };
}

// ═══════════════════════════════════════════
// mnemosyne_list
// ═══════════════════════════════════════════

export function registerListTool(state: PluginState, toolCtx: ToolRuntimeContext) {
  return {
    name: "mnemosyne_list",
    label: "Mnemosyne List",
    description: "List all explicit memories for the current session with their last-updated timestamps.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "Max results",
        },
      },
      required: [],
    },
    execute: withErrorHandling(async (_toolCallId: string, params: Record<string, unknown>) => {
      const limit = clampInt(params.limit, 20, 1, 100);
      const store = storeFor(state, toolCtx);

      return withRetry(() => {
        const rows = store.list(limit);

        if (rows.length === 0) {
          return { content: [{ type: "text", text: "No memories stored yet." }], details: { count: 0 } };
        }

        const lines = rows.map((r) => `- ${r.key}: ${r.value} (${store.scopeOf(r.session_key)})`);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { count: rows.length },
        };
      });
    }, "mnemosyne_list"),
  };
}

// ═══════════════════════════════════════════
// mnemosyne_forget
// ═══════════════════════════════════════════

export function registerForgetTool(state: PluginState, toolCtx: ToolRuntimeContext) {
  return {
    name: "mnemosyne_forget",
    label: "Mnemosyne Forget",
    description: "Delete a memory by exact key from the current session, agent-wide scope, or both.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        key: {
          type: "string",
          description: "Exact key to delete",
        },
        scope: {
          type: "string",
          enum: ["session", "agent", "all"],
          default: "session",
          description: "Which scope to delete from. 'all' deletes both current-session and agent-wide memories.",
        },
      },
      required: ["key"],
    },
    execute: withErrorHandling(async (_toolCallId: string, params: Record<string, unknown>) => {
      const key = normalizeKey(params.key);
      const scope: ForgetScope = params.scope === "agent" || params.scope === "all" ? params.scope : "session";
      if (!key) {
        throw new Error("mnemosyne_forget requires 'key'");
      }
      if (key.length > MAX_KEY_LENGTH) {
        throw new Error(`mnemosyne_forget: key exceeds maximum length of ${MAX_KEY_LENGTH} characters`);
      }

      const store = storeFor(state, toolCtx);
      return withRetry(() => {
        const deleted = store.forget(scope, key);
        return {
          content: [{ type: "text", text: `Deleted ${deleted} memory from ${scope} scope.` }],
          details: { key, scope, deleted },
        };
      });
    }, "mnemosyne_forget"),
  };
}