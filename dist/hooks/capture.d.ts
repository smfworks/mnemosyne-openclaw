/**
 * Mnemosyne conversation capture hook — runs on every agent_end.
 * Automatically persists conversation turns to SQLite. Zero LLM overhead.
 */
import { PluginState } from "../state.js";
export interface CaptureApi {
    logger: {
        info: (msg: string) => void;
        warn: (msg: string) => void;
        error: (msg: string) => void;
    };
}
export declare function registerCaptureHook(api: CaptureApi, state: PluginState): void;
/** The actual hook handler called by api.on('agent_end', ...) */
export declare function onAgentEnd(event: {
    success: boolean;
    messages?: unknown[];
    durationMs?: number;
}, ctx: {
    sessionKey?: string;
    agentId?: string;
    runId?: string;
}, state: PluginState): Promise<void>;
//# sourceMappingURL=capture.d.ts.map