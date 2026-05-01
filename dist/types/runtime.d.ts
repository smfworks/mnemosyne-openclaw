/**
 * Shared types used across Mnemosyne modules.
 */
/** Runtime context passed by OpenClaw to each tool factory */
export interface ToolRuntimeContext {
    sessionKey?: string;
    agentId?: string;
    sandboxed?: boolean;
    [key: string]: unknown;
}
//# sourceMappingURL=runtime.d.ts.map