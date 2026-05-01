/**
 * Mnemosyne explicit memory tools.
 * These are exposed to the agent as callable tools, separate from automatic capture.
 *
 * Each tool factory receives the OpenClaw runtime context (sessionKey, agentId, sandboxed)
 * so that memories are scoped to the actual session, not a hardcoded default.
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
    execute(_toolCallId: string, params: Record<string, unknown>): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        details: {
            key: string;
            value: string;
            scope: string;
        };
    }>;
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
    execute(_toolCallId: string, params: Record<string, unknown>): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        details: {
            count: number;
            keys?: undefined;
        };
    } | {
        content: {
            type: string;
            text: string;
        }[];
        details: {
            count: number;
            keys: string[];
        };
    }>;
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
    execute(_toolCallId: string, params: Record<string, unknown>): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        details: {
            count: number;
            query: string;
        };
    }>;
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
    execute(_toolCallId: string, params: Record<string, unknown>): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        details: {
            count: number;
        };
    }>;
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
        };
        required: string[];
    };
    execute(_toolCallId: string, params: Record<string, unknown>): Promise<{
        content: {
            type: string;
            text: string;
        }[];
        details: {
            key: string;
            deleted: number;
        };
    }>;
};
//# sourceMappingURL=index.d.ts.map