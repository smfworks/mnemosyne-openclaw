import { buildSessionKey, extractMessages } from "../helpers.js";
import { ScopedStore } from "../dal.js";
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
    const agentId = ctx.agentId ?? "main";
    const extracted = extractMessages(event.messages, state.cfg.noisePatterns, state.cfg.ownerObserveOthers);
    if (extracted.length === 0)
        return;
    // All persistence + bounded pruning goes through the agent-scoped DAL.
    new ScopedStore(state, agentId, sessionKey).captureMessages(extracted);
}
//# sourceMappingURL=capture.js.map