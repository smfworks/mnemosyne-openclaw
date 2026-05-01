/**
 * Minimal type declarations for OpenClaw plugin API surface.
 * Covers only the methods Mnemosyne uses.
 */

declare module "openclaw/plugin-sdk" {
  export function definePluginEntry(options: {
    id: string;
    name: string;
    description: string;
    kind?: string;
    configSchema?: unknown;
    register: (api: OpenClawPluginApi) => void;
  }): DefinedPluginEntry;

  export interface OpenClawPluginApi {
    logger: PluginLogger;
    pluginConfig: unknown;
    on: <K extends PluginHookName>(
      hookName: K,
      handler: PluginHookHandlerMap[K],
      opts?: { priority?: number }
    ) => void;
    registerTool: (
      factory: (toolCtx: PluginToolContext) => AgentTool,
      opts?: { name?: string }
    ) => void;
    registerCommand: (command: PluginCommandDefinition) => void;
    registerMemoryCapability: (capability: MemoryPluginCapability) => void;
    registerMemoryPromptSupplement: (builder: MemoryPromptSectionBuilder) => void;
    registerRuntimeLifecycle: (lifecycle: PluginRuntimeLifecycleRegistration) => void;
    resolvePath: (input: string) => string;
    config?: Record<string, unknown>;
  }

  export interface PluginLogger {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  }

  export type PluginHookName =
    | "agent_end"
    | "before_compaction"
    | "gateway_start"
    | "gateway_stop"
    | "session_start"
    | "session_end";

  export interface PluginHookAgentEndEvent {
    success: boolean;
    messages?: unknown[];
    durationMs?: number;
    error?: string;
  }

  export interface PluginHookAgentContext {
    runId?: string;
    sessionKey?: string;
    agentId?: string;
    sessionId?: string;
    workspaceDir?: string;
  }

  export interface PluginHookHandlerMap {
    agent_end: (
      event: PluginHookAgentEndEvent,
      ctx: PluginHookAgentContext
    ) => Promise<void> | void;
  }

  export interface PluginToolContext {
    agentId?: string;
    sessionKey?: string;
    sandboxed?: boolean;
    config?: Record<string, unknown>;
  }

  export interface AgentTool {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
  }

  export interface PluginCommandDefinition {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    handler: (ctx: PluginCommandContext) => Promise<PluginCommandResult> | PluginCommandResult;
  }

  export interface PluginCommandContext {
    args?: string;
    gatewayClientScopes?: string[];
  }

  export interface PluginCommandResult {
    text: string;
  }

  export interface MemoryPluginCapability {
    promptBuilder?: MemoryPromptSectionBuilder;
    flushPlanResolver?: MemoryFlushPlanResolver;
    runtime?: MemoryPluginRuntime;
    publicArtifacts?: { listArtifacts: (...args: unknown[]) => unknown[] };
  }

  export type MemoryPromptSectionBuilder = () => string[];
  export type MemoryFlushPlanResolver = (...args: unknown[]) => unknown;
  export type MemoryPluginRuntime = (...args: unknown[]) => unknown;

  export interface PluginRuntimeLifecycleRegistration {
    onPluginLoad?: () => void;
    onPluginUnload?: () => void;
    onGatewayShutdown?: () => void;
  }

  export interface DefinedPluginEntry {
    id: string;
    name: string;
    description: string;
    kind?: string;
    register: (api: OpenClawPluginApi) => void;
  }
}
