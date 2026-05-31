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
    // Prune if over limit — single bounded DELETE with no per-id bind parameters,
    // so a large session can never exceed SQLite's host-parameter ceiling. The
    // secondary id sort makes the keep-set deterministic when timestamps collide.
    state.db.prepare(`
    DELETE FROM messages
    WHERE session_key = ?
      AND id NOT IN (
        SELECT id FROM messages
        WHERE session_key = ?
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
      )
  `).run(sessionKey, sessionKey, state.cfg.maxMessagesPerSession);
}
//# sourceMappingURL=capture.js.map