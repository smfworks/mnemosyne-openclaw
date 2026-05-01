import { ToolRuntimeContext } from "./types/runtime.js";
interface PluginApi {
    logger: {
        info: (m: string) => void;
        warn: (m: string) => void;
        error: (m: string) => void;
    };
    pluginConfig: unknown;
    on: (hook: string, handler: (...args: unknown[]) => void | Promise<void>, opts?: {
        priority?: number;
    }) => void;
    registerTool: (factory: (ctx: ToolRuntimeContext) => Record<string, unknown>, opts?: {
        name?: string;
    }) => void;
    registerCommand: (cmd: {
        name: string;
        description: string;
        acceptsArgs?: boolean;
        handler: (ctx: {
            args?: string;
            gatewayClientScopes?: string[];
        }) => Promise<{
            text: string;
        }> | {
            text: string;
        };
    }) => void;
    registerMemoryPromptSupplement: (builder: () => string[]) => void;
    registerRuntimeLifecycle: (lifecycle: {
        id: string;
        onPluginUnload?: () => void;
    }) => void;
}
declare const pluginEntry: {
    id: string;
    name: string;
    description: string;
    kind: "memory";
    register(api: PluginApi): void;
};
export default pluginEntry;
//# sourceMappingURL=index.d.ts.map