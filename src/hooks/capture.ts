/**
 * Mnemosyne conversation capture hook — runs on every agent_end.
 * Automatically persists conversation turns to SQLite. Zero LLM overhead.
 */
import { PluginState } from "../state.js";
import { buildSessionKey, extractMessages } from "../helpers.js";

export interface CaptureApi {
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export function registerCaptureHook(api: CaptureApi, state: PluginState): void {
  api.logger.info("[mnemosyne] Capture hook registered");

  // We attach to agent_end via OpenClaw's api.on() in the main plugin register().
  // This module exports the handler function.
}

/** The actual hook handler called by api.on('agent_end', ...) */
export async function onAgentEnd(
  event: { success: boolean; messages?: unknown[]; durationMs?: number },
  ctx: { sessionKey?: string; agentId?: string; runId?: string },
  state: PluginState
): Promise<void> {
  if (!event.success || !event.messages?.length) return;

  const sessionKey = buildSessionKey(ctx);
  const extracted = extractMessages(
    event.messages as unknown[],
    state.cfg.noisePatterns,
    state.cfg.ownerObserveOthers
  );
  if (extracted.length === 0) return;

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
  const keepRows = state.db.prepare(
    `SELECT id FROM messages WHERE session_key = ? ORDER BY timestamp DESC LIMIT ?`
  ).all(sessionKey, state.cfg.maxMessagesPerSession) as Array<{ id: number }>;
  const keepIds = keepRows.map((r) => r.id);
  if (keepIds.length >= state.cfg.maxMessagesPerSession) {
    const placeholders = keepIds.map(() => "?").join(",");
    state.db.prepare(
      `DELETE FROM messages WHERE session_key = ? AND id NOT IN (${placeholders})`
    ).run(sessionKey, ...keepIds);
  }
}
