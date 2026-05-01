// ── Error guards ──
/** Check if an error is a transient SQLITE_BUSY (WAL contention) */
function isBusyError(err) {
    if (!(err instanceof Error))
        return false;
    return err.message.includes("SQLITE_BUSY") || err.code === "SQLITE_BUSY";
}
/** Retry a synchronous operation up to 3 times with exponential backoff for SQLITE_BUSY */
function withRetry(fn, maxRetries = 3) {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return fn();
        }
        catch (err) {
            if (i === maxRetries || !isBusyError(err))
                throw err;
            // small backoff before retry
            const ms = Math.min(100 * Math.pow(2, i), 500);
            const start = Date.now();
            while (Date.now() - start < ms) { /* spin */ }
        }
    }
    throw new Error("unreachable");
}
// ── Resolve session key ──
function resolveSessionKey(toolCtx) {
    if (toolCtx.sessionKey)
        return toolCtx.sessionKey;
    return `agent_${toolCtx.agentId ?? "main"}_default`;
}
function resolveAgentId(toolCtx) {
    return toolCtx.agentId ?? "main";
}
// ═══════════════════════════════════════════
// mnemosyne_remember
// ═══════════════════════════════════════════
export function registerRememberTool(state, toolCtx) {
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
        async execute(_toolCallId, params) {
            const key = String(params.key ?? "").trim().toLowerCase();
            const value = String(params.value ?? "").trim();
            const scope = params.scope === "agent" ? "agent" : "session";
            if (!key || !value) {
                throw new Error("mnemosyne_remember requires 'key' and 'value'");
            }
            const sessionKey = resolveSessionKey(toolCtx);
            const agentId = resolveAgentId(toolCtx);
            return withRetry(() => {
                const stmt = state.db.prepare(`
          INSERT INTO memories (session_key, agent_id, key, value, timestamp, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_key, key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        `);
                const now = Date.now();
                stmt.run(sessionKey, agentId, key, value, now, now);
                // Update session stats
                const sessionStmt = state.db.prepare(`
          INSERT INTO sessions (session_key, agent_id, updated_at, memory_count)
          VALUES (?, ?, ?, 1)
          ON CONFLICT(session_key) DO UPDATE SET
            updated_at = excluded.updated_at,
            memory_count = memory_count + 1
        `);
                sessionStmt.run(sessionKey, agentId, now);
                // Prune excess memories
                const prune = state.db.prepare(`
          DELETE FROM memories
          WHERE id IN (
            SELECT id FROM memories
            WHERE session_key = ?
            ORDER BY updated_at DESC
            OFFSET ?
          )
        `);
                prune.run(sessionKey, state.cfg.maxMemoriesPerSession);
                return {
                    content: [{ type: "text", text: `Remembered: ${key} = ${value} (${scope})` }],
                    details: { key, value, scope },
                };
            });
        },
    };
}
// ═══════════════════════════════════════════
// mnemosyne_recall
// ═══════════════════════════════════════════
export function registerRecallTool(state, toolCtx) {
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
        async execute(_toolCallId, params) {
            const key = String(params.key ?? "").trim().toLowerCase();
            const query = String(params.query ?? "").trim().toLowerCase();
            const crossSession = Boolean(params.cross_session);
            const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 50);
            const sessionKey = resolveSessionKey(toolCtx);
            return withRetry(() => {
                let rows;
                if (crossSession && (key || query)) {
                    // Cross-session: search across all sessions (no session filter)
                    const searchTerm = key || query;
                    const stmt = state.db.prepare(`
            SELECT key, value, updated_at, session_key FROM memories
            WHERE (key LIKE ? OR value LIKE ?)
            ORDER BY updated_at DESC
            LIMIT ?
          `);
                    const like = `%${searchTerm}%`;
                    rows = stmt.all(like, like, limit);
                }
                else if (key) {
                    const stmt = state.db.prepare(`
            SELECT key, value, updated_at, session_key FROM memories
            WHERE session_key = ? AND key = ?
            ORDER BY updated_at DESC
            LIMIT ?
          `);
                    rows = stmt.all(sessionKey, key, limit);
                }
                else if (query) {
                    const stmt = state.db.prepare(`
            SELECT key, value, updated_at, session_key FROM memories
            WHERE session_key = ? AND (key LIKE ? OR value LIKE ?)
            ORDER BY updated_at DESC
            LIMIT ?
          `);
                    const like = `%${query}%`;
                    rows = stmt.all(sessionKey, like, like, limit);
                }
                else {
                    const stmt = state.db.prepare(`
            SELECT key, value, updated_at, session_key FROM memories
            WHERE session_key = ?
            ORDER BY updated_at DESC
            LIMIT ?
          `);
                    rows = stmt.all(sessionKey, limit);
                }
                if (rows.length === 0) {
                    return {
                        content: [{ type: "text", text: "No memories found." }],
                        details: { count: 0 },
                    };
                }
                const lines = rows.map((r) => `- ${r.key}: ${r.value}${crossSession ? ` (session: ${r.session_key.slice(0, 20)}…)` : ""}`);
                return {
                    content: [{ type: "text", text: lines.join("\n") }],
                    details: { count: rows.length, keys: rows.map((r) => r.key) },
                };
            });
        },
    };
}
// ═══════════════════════════════════════════
// mnemosyne_search (FTS5 full-text)
// ═══════════════════════════════════════════
export function registerSearchTool(state, toolCtx) {
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
        async execute(_toolCallId, params) {
            const query = String(params.query ?? "").trim();
            if (!query)
                throw new Error("mnemosyne_search requires 'query'");
            const source = (params.source === "messages" || params.source === "memories") ? params.source : "all";
            const limit = Math.min(Math.max(Number(params.limit) || 10, 1), 50);
            return withRetry(() => {
                const results = [];
                if (source === "all" || source === "messages") {
                    const msgStmt = state.db.prepare(`
            SELECT content, session_key, rank FROM messages_fts
            WHERE messages_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `);
                    const msgRows = msgStmt.all(query, limit);
                    for (const r of msgRows) {
                        results.push({
                            source: "message",
                            text: r.content.length > 200 ? r.content.slice(0, 200) + "…" : r.content,
                            session: r.session_key.slice(0, 24),
                            rank: r.rank,
                        });
                    }
                }
                if (source === "all" || source === "memories") {
                    const memStmt = state.db.prepare(`
            SELECT key, value, session_key, rank FROM memories_fts
            WHERE memories_fts MATCH ?
            ORDER BY rank
            LIMIT ?
          `);
                    const memRows = memStmt.all(query, limit);
                    for (const r of memRows) {
                        results.push({
                            source: "memory",
                            text: `${r.key}: ${r.value}`,
                            session: r.session_key.slice(0, 24),
                            rank: r.rank,
                        });
                    }
                }
                // Sort combined results by rank and trim
                results.sort((a, b) => a.rank - b.rank);
                const trimmed = results.slice(0, limit);
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
        },
    };
}
// ═══════════════════════════════════════════
// mnemosyne_list
// ═══════════════════════════════════════════
export function registerListTool(state, toolCtx) {
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
        async execute(_toolCallId, params) {
            const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
            const sessionKey = resolveSessionKey(toolCtx);
            return withRetry(() => {
                const stmt = state.db.prepare(`
          SELECT key, value, updated_at FROM memories
          WHERE session_key = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `);
                const rows = stmt.all(sessionKey, limit);
                if (rows.length === 0) {
                    return { content: [{ type: "text", text: "No memories stored yet." }], details: { count: 0 } };
                }
                const lines = rows.map((r) => `- ${r.key}: ${r.value}`);
                return {
                    content: [{ type: "text", text: lines.join("\n") }],
                    details: { count: rows.length },
                };
            });
        },
    };
}
// ═══════════════════════════════════════════
// mnemosyne_forget
// ═══════════════════════════════════════════
export function registerForgetTool(state, toolCtx) {
    return {
        name: "mnemosyne_forget",
        label: "Mnemosyne Forget",
        description: "Delete a memory by exact key.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                key: {
                    type: "string",
                    description: "Exact key to delete",
                },
            },
            required: ["key"],
        },
        async execute(_toolCallId, params) {
            const key = String(params.key ?? "").trim().toLowerCase();
            if (!key)
                throw new Error("mnemosyne_forget requires 'key'");
            const sessionKey = resolveSessionKey(toolCtx);
            return withRetry(() => {
                const stmt = state.db.prepare(`DELETE FROM memories WHERE session_key = ? AND key = ?`);
                const info = stmt.run(sessionKey, key);
                return {
                    content: [{ type: "text", text: `Deleted ${info.changes} memory.` }],
                    details: { key, deleted: info.changes },
                };
            });
        },
    };
}
//# sourceMappingURL=index.js.map