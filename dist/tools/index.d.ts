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
export declare function registerRememberTool(state: PluginState, toolCtx: ToolRuntimeContext): {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        properties: {
            key: {
                type: string;
                description: string;
            };
            value: {
                type: string;
                description: string;
            };
            scope: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
};
export declare function registerRecallTool(state: PluginState, toolCtx: ToolRuntimeContext): {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        properties: {
            key: {
                type: string;
                description: string;
            };
            query: {
                type: string;
                description: string;
            };
            cross_session: {
                type: string;
                default: boolean;
                description: string;
            };
            limit: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
        };
        required: never[];
    };
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
};
export declare function registerSearchTool(state: PluginState, toolCtx: ToolRuntimeContext): {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        properties: {
            query: {
                type: string;
                description: string;
            };
            source: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
            limit: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
        };
        required: string[];
    };
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
};
export declare function registerListTool(state: PluginState, toolCtx: ToolRuntimeContext): {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        properties: {
            limit: {
                type: string;
                minimum: number;
                maximum: number;
                default: number;
                description: string;
            };
        };
        required: never[];
    };
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
};
export declare function registerForgetTool(state: PluginState, toolCtx: ToolRuntimeContext): {
    name: string;
    label: string;
    description: string;
    parameters: {
        type: string;
        additionalProperties: boolean;
        properties: {
            key: {
                type: string;
                description: string;
            };
            scope: {
                type: string;
                enum: string[];
                default: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
};
//# sourceMappingURL=index.d.ts.map