/** Build a quoted-term FTS5 MATCH expression (terms ANDed; embedded quotes escaped). */
function toFtsQuery(input) {
    const terms = input
        .trim()
        .split(/\s+/)
        .map((term) => term.replace(/"/g, '""'))
        .filter(Boolean);
    return terms.map((term) => `"${term}"`).join(" ");
}
/**
 * An agent/session-scoped handle to the content tables. Construct one per request
 * with the caller's resolved `agentId` and `sessionKey`; never share across agents.
 */
export class ScopedStore {
    state;
    agentId;
    sessionKey;
    agentKey;
    readableKeys;
    placeholders;
    constructor(state, agentId, sessionKey) {
        this.state = state;
        this.agentId = agentId;
        this.sessionKey = sessionKey;
        this.agentKey = `agent:${agentId}:global`;
        this.readableKeys =
            sessionKey === this.agentKey ? [sessionKey] : [sessionKey, this.agentKey];
        this.placeholders = this.readableKeys.map(() => "?").join(",");
    }
    get db() {
        return this.state.db;
    }
    /** Classify a row's session_key as agent-wide or session-local for display. */
    scopeOf(rowSessionKey) {
        return rowSessionKey === this.agentKey ? "agent" : "session";
    }
    scopeKey(scope) {
        return scope === "agent" ? this.agentKey : this.sessionKey;
    }
    refreshMemoryCount(sessionKey, now = Date.now()) {
        const row = this.db
            .prepare(`SELECT COUNT(*) as c FROM memories WHERE session_key = ?`)
            .get(sessionKey);
        this.db
            .prepare(`
        INSERT INTO sessions (session_key, agent_id, updated_at, memory_count)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_key) DO UPDATE SET
          updated_at = excluded.updated_at,
          memory_count = excluded.memory_count
      `)
            .run(sessionKey, this.agentId, now, row.c);
    }
    // ── Writes ──
    /** Upsert an explicit memory in the given scope, then prune to the configured cap. */
    rememberMemory(scope, key, value) {
        const target = this.scopeKey(scope);
        const now = Date.now();
        this.db
            .prepare(`
        INSERT INTO memories (session_key, agent_id, key, value, timestamp, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_key, key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `)
            .run(target, this.agentId, key, value, now, now);
        // Bounded prune — LIMIT -1 OFFSET keeps the N most-recent rows; SQLite rejects
        // OFFSET without LIMIT, hence the explicit -1 ("no limit").
        this.db
            .prepare(`
        DELETE FROM memories
        WHERE id IN (
          SELECT id FROM memories
          WHERE session_key = ?
          ORDER BY updated_at DESC
          LIMIT -1 OFFSET ?
        )
      `)
            .run(target, this.state.cfg.maxMemoriesPerSession);
        this.refreshMemoryCount(target, now);
        return { scope };
    }
    /** Delete a memory by exact key from the session, agent, or both scopes. */
    forget(scope, key) {
        const targets = scope === "all" ? this.readableKeys : [this.scopeKey(scope)];
        const placeholders = targets.map(() => "?").join(",");
        const info = this.db
            .prepare(`DELETE FROM memories WHERE session_key IN (${placeholders}) AND key = ?`)
            .run(...targets, key);
        for (const target of targets)
            this.refreshMemoryCount(target);
        return info.changes;
    }
    /** Persist captured conversation turns for this session, then prune to the cap. */
    captureMessages(messages) {
        if (messages.length === 0)
            return;
        const insertStmt = this.db.prepare(`
      INSERT INTO messages (session_key, agent_id, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
        const updateSessionStmt = this.db.prepare(`
      INSERT INTO sessions (session_key, agent_id, updated_at, message_count)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        updated_at = excluded.updated_at,
        message_count = message_count + excluded.message_count
    `);
        const now = Date.now();
        this.db.transaction(() => {
            for (const m of messages) {
                insertStmt.run(this.sessionKey, this.agentId, m.role, m.content, m.timestamp);
            }
            updateSessionStmt.run(this.sessionKey, this.agentId, now, messages.length);
        })();
        // Single bounded DELETE with no per-id bind parameters, so a large session can
        // never exceed SQLite's host-parameter ceiling. The secondary id sort makes
        // the keep-set deterministic when timestamps collide.
        this.db
            .prepare(`
        DELETE FROM messages
        WHERE session_key = ?
          AND id NOT IN (
            SELECT id FROM messages
            WHERE session_key = ?
            ORDER BY timestamp DESC, id DESC
            LIMIT ?
          )
      `)
            .run(this.sessionKey, this.sessionKey, this.state.cfg.maxMessagesPerSession);
    }
    // ── Reads ──
    /** Recall explicit memories by exact key or fuzzy query, scoped to this agent. */
    recall(params) {
        const { key, query, crossSession, limit } = params;
        // Exact-key lookup — fastest path.
        if (key) {
            if (crossSession) {
                // Cross-session, but still scoped to THIS agent (never leak other agents).
                return this.db
                    .prepare(`
            SELECT key, value, updated_at, session_key FROM memories
            WHERE key = ? AND agent_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
          `)
                    .all(key, this.agentId, limit);
            }
            return this.db
                .prepare(`
          SELECT key, value, updated_at, session_key FROM memories
          WHERE session_key IN (${this.placeholders}) AND key = ?
          ORDER BY CASE WHEN session_key = ? THEN 0 ELSE 1 END, updated_at DESC
          LIMIT ?
        `)
                .all(...this.readableKeys, key, this.sessionKey, limit);
        }
        // Query-based recall — FTS5 with stemming when available.
        if (query && this.state.cfg.enableFts) {
            const ftsQuery = toFtsQuery(query);
            if (crossSession) {
                // FTS across this agent's sessions only — join base table to filter agent_id.
                return this.db
                    .prepare(`
            SELECT m.key AS key, m.value AS value, m.updated_at AS updated_at, m.session_key AS session_key, memories_fts.rank AS rank
            FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
            WHERE memories_fts MATCH ? AND m.agent_id = ?
            ORDER BY memories_fts.rank
            LIMIT ?
          `)
                    .all(ftsQuery, this.agentId, limit);
            }
            return this.db
                .prepare(`
          SELECT key, value, updated_at, session_key, rank FROM memories_fts
          WHERE memories_fts MATCH ? AND session_key IN (${this.placeholders})
          ORDER BY CASE WHEN session_key = ? THEN 0 ELSE 1 END, rank
          LIMIT ?
        `)
                .all(ftsQuery, ...this.readableKeys, this.sessionKey, limit);
        }
        // Query-based recall — LIKE fallback when FTS is disabled.
        if (query) {
            const like = `%${query}%`;
            if (crossSession) {
                return this.db
                    .prepare(`
            SELECT key, value, updated_at, session_key FROM memories
            WHERE agent_id = ? AND (key LIKE ? OR value LIKE ?)
            ORDER BY updated_at DESC
            LIMIT ?
          `)
                    .all(this.agentId, like, like, limit);
            }
            return this.db
                .prepare(`
          SELECT key, value, updated_at, session_key FROM memories
          WHERE session_key IN (${this.placeholders}) AND (key LIKE ? OR value LIKE ?)
          ORDER BY CASE WHEN session_key = ? THEN 0 ELSE 1 END, updated_at DESC
          LIMIT ?
        `)
                .all(...this.readableKeys, like, like, this.sessionKey, limit);
        }
        // No params — list this session's memories.
        return this.db
            .prepare(`
        SELECT key, value, updated_at, session_key FROM memories
        WHERE session_key IN (${this.placeholders})
        ORDER BY CASE WHEN session_key = ? THEN 0 ELSE 1 END, updated_at DESC
        LIMIT ?
      `)
            .all(...this.readableKeys, this.sessionKey, limit);
    }
    /** Full-text (or LIKE-fallback) search across this agent's messages/memories. */
    search(params) {
        const { query, source, limit } = params;
        const ftsQuery = toFtsQuery(query);
        const ftsEnabled = this.state.cfg.enableFts !== false;
        const results = [];
        if (source === "all" || source === "messages") {
            if (ftsEnabled) {
                // Join base table so results stay scoped to THIS agent (no cross-agent leak).
                const rows = this.db
                    .prepare(`
            SELECT m.content AS content, m.session_key AS session_key, messages_fts.rank AS rank
            FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
            WHERE messages_fts MATCH ? AND m.agent_id = ?
            ORDER BY messages_fts.rank
            LIMIT ?
          `)
                    .all(ftsQuery, this.agentId, limit);
                for (const r of rows) {
                    results.push({
                        source: "message",
                        text: r.content.length > 200 ? r.content.slice(0, 200) + "…" : r.content,
                        session: r.session_key.slice(0, 24),
                        rank: r.rank,
                    });
                }
            }
            else {
                const rows = this.db
                    .prepare(`
            SELECT content, session_key, timestamp FROM messages
            WHERE agent_id = ? AND content LIKE ?
            ORDER BY timestamp DESC
            LIMIT ?
          `)
                    .all(this.agentId, `%${query}%`, limit);
                for (const r of rows) {
                    results.push({
                        source: "message",
                        text: r.content.length > 200 ? r.content.slice(0, 200) + "…" : r.content,
                        session: r.session_key.slice(0, 24),
                        rank: 0,
                    });
                }
            }
        }
        if (source === "all" || source === "memories") {
            if (ftsEnabled) {
                const rows = this.db
                    .prepare(`
            SELECT m.key AS key, m.value AS value, m.session_key AS session_key, memories_fts.rank AS rank
            FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
            WHERE memories_fts MATCH ? AND m.agent_id = ?
            ORDER BY memories_fts.rank
            LIMIT ?
          `)
                    .all(ftsQuery, this.agentId, limit);
                for (const r of rows) {
                    results.push({
                        source: "memory",
                        text: `${r.key}: ${r.value}`,
                        session: r.session_key.slice(0, 24),
                        rank: r.rank,
                    });
                }
            }
            else {
                const like = `%${query}%`;
                const rows = this.db
                    .prepare(`
            SELECT key, value, session_key, updated_at FROM memories
            WHERE agent_id = ? AND (key LIKE ? OR value LIKE ?)
            ORDER BY updated_at DESC
            LIMIT ?
          `)
                    .all(this.agentId, like, like, limit);
                for (const r of rows) {
                    results.push({
                        source: "memory",
                        text: `${r.key}: ${r.value}`,
                        session: r.session_key.slice(0, 24),
                        rank: 0,
                    });
                }
            }
        }
        results.sort((a, b) => a.rank - b.rank);
        return results.slice(0, limit);
    }
    /** List this session's explicit memories (most-recently-updated first). */
    list(limit) {
        return this.db
            .prepare(`
        SELECT key, value, updated_at, session_key FROM memories
        WHERE session_key IN (${this.placeholders})
        ORDER BY CASE WHEN session_key = ? THEN 0 ELSE 1 END, updated_at DESC
        LIMIT ?
      `)
            .all(...this.readableKeys, this.sessionKey, limit);
    }
}
/**
 * Deliberately-unscoped row counts for the admin-gated `/mnemosyne stats` command.
 * This is the one place a global aggregate over the content tables is permitted;
 * it returns counts only (never content) and is reachable only behind the trusted
 * scope check in the command handler.
 */
export function globalCounts(state) {
    const one = (sql) => state.db.prepare(sql).get().c;
    return {
        messages: one(`SELECT COUNT(*) as c FROM messages`),
        memories: one(`SELECT COUNT(*) as c FROM memories`),
        sessions: one(`SELECT COUNT(*) as c FROM sessions`),
    };
}
//# sourceMappingURL=dal.js.map