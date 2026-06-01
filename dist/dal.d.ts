/**
 * Mnemosyne data-access layer (DAL).
 *
 * SECURITY-CRITICAL: this module is the ONLY place in the codebase that is
 * allowed to read or write the content tables (`messages`, `memories`, and their
 * FTS shadows). Every query is issued through a {@link ScopedStore} that is bound
 * to a concrete `{ agentId, sessionKey }` at construction time and injects the
 * agent/session filter on every statement. That makes a cross-agent leak
 * *unrepresentable* in calling code: tools and hooks cannot forget a `WHERE`
 * clause because they never write SQL — they ask the store for already-scoped
 * results. A `tests/isolation-guard.test.js` check fails the build if any file
 * outside this module (and the schema in `database.ts`) touches those tables.
 *
 * The one deliberately-unscoped read is {@link globalCounts}, used only by the
 * admin-gated `/mnemosyne stats` command, and it is named to make that explicit.
 */
import { PluginState } from "./state.js";
import { ExtractedMessage } from "./helpers.js";
export type MemoryScope = "session" | "agent";
export type ForgetScope = MemoryScope | "all";
export interface MemoryRow {
    key: string;
    value: string;
    updated_at: number;
    session_key: string;
}
export interface SearchHit {
    source: "message" | "memory";
    text: string;
    session: string;
    rank: number;
}
export interface RecallParams {
    key?: string;
    query?: string;
    crossSession: boolean;
    limit: number;
}
export interface SearchParams {
    query: string;
    source: "messages" | "memories" | "all";
    limit: number;
}
/**
 * An agent/session-scoped handle to the content tables. Construct one per request
 * with the caller's resolved `agentId` and `sessionKey`; never share across agents.
 */
export declare class ScopedStore {
    private readonly state;
    private readonly agentId;
    private readonly sessionKey;
    private readonly agentKey;
    private readonly readableKeys;
    private readonly placeholders;
    constructor(state: PluginState, agentId: string, sessionKey: string);
    private get db();
    /** Classify a row's session_key as agent-wide or session-local for display. */
    scopeOf(rowSessionKey: string): MemoryScope;
    private scopeKey;
    private refreshMemoryCount;
    /** Upsert an explicit memory in the given scope, then prune to the configured cap. */
    rememberMemory(scope: MemoryScope, key: string, value: string): {
        scope: MemoryScope;
    };
    /** Delete a memory by exact key from the session, agent, or both scopes. */
    forget(scope: ForgetScope, key: string): number;
    /** Persist captured conversation turns for this session, then prune to the cap. */
    captureMessages(messages: ExtractedMessage[]): void;
    /** Recall explicit memories by exact key or fuzzy query, scoped to this agent. */
    recall(params: RecallParams): MemoryRow[];
    /** Full-text (or LIKE-fallback) search across this agent's messages/memories. */
    search(params: SearchParams): SearchHit[];
    /** List this session's explicit memories (most-recently-updated first). */
    list(limit: number): MemoryRow[];
}
/**
 * Deliberately-unscoped row counts for the admin-gated `/mnemosyne stats` command.
 * This is the one place a global aggregate over the content tables is permitted;
 * it returns counts only (never content) and is reachable only behind the trusted
 * scope check in the command handler.
 */
export declare function globalCounts(state: PluginState): {
    messages: number;
    memories: number;
    sessions: number;
};
//# sourceMappingURL=dal.d.ts.map