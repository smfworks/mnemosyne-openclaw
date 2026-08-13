/**
 * Mnemosyne conversation capture hook — runs on every agent_end.
 * Automatically persists conversation turns to SQLite. Zero LLM overhead.
 */
import { PluginState } from "../state.js";
import { buildSessionKey, extractMessages } from "../helpers.js";
import { ScopedStore } from "../dal.js";
import { withRetry } from "../retry.js";

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
  ctx: { sessionKey?: string; sessionId?: string; agentId?: string; runId?: string },
  state: PluginState
): Promise<void> {
  if (!event.success || !event.messages?.length) return;

  const sessionKey = buildSessionKey(ctx);
  const agentId = ctx.agentId ?? "main";
  const extracted = extractMessages(
    event.messages as unknown[],
    state.cfg.noisePatterns,
    state.cfg.ownerObserveOthers
  );
  if (extracted.length === 0) return;

  // All persistence + bounded pruning goes through the agent-scoped DAL.
  // Wrap in withRetry so transient SQLITE_BUSY doesn't silently drop captures.
  withRetry(() => {
    new ScopedStore(state, agentId, sessionKey).captureMessages(extracted);
  });
}
