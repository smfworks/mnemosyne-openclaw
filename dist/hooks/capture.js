import { buildSessionKey, extractMessages } from "../helpers.js";
export function registerCaptureHook(api, state) {
    api.logger.info("[mnemosyne] Capture hook registered");
    // We attach to agent_end via OpenClaw's api.on() in the main plugin register().
    // This module exports the handler function.
}
/** The actual hook handler called by api.on('agent_end', ...) */
export async function onAgentEnd(event, ctx, state) {
    if (!event.success || !event.messages?.length)
        return;
    const sessionKey = buildSessionKey(ctx);
    const extracted = extractMessages(event.messages, state.cfg.noisePatterns, state.cfg.ownerObserveOthers);
    if (extracted.length === 0)
        return;
    const insertStmt = state.db.prepare(`
    INSERT INTO messages (session_key, agent_id, role, content, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);
    const updateSessionStmt = state.db.prepare(`
    INSERT INTO sessions (session_key, agent_id, updated_at, message_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET
      updated_at = excluded.updated_at,
      message_count = message_count + excluded.message_count
  `);
    const now = Date.now();
    const agentId = ctx.agentId ?? "main";
    state.db.transaction(() => {
        for (const m of extracted) {
            insertStmt.run(sessionKey, agentId, m.role, m.content, m.timestamp);
        }
        updateSessionStmt.run(sessionKey, agentId, now, extracted.length);
    })();
    // Prune if over limit — two-step for SQLite compatibility
    const keepRows = state.db.prepare(`SELECT id FROM messages WHERE session_key = ? ORDER BY timestamp DESC LIMIT ?`).all(sessionKey, state.cfg.maxMessagesPerSession);
    const keepIds = keepRows.map((r) => r.id);
    if (keepIds.length >= state.cfg.maxMessagesPerSession) {
        const placeholders = keepIds.map(() => "?").join(",");
        state.db.prepare(`DELETE FROM messages WHERE session_key = ? AND id NOT IN (${placeholders})`).run(sessionKey, ...keepIds);
    }
}
//# sourceMappingURL=capture.js.map