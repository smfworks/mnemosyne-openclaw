/**
 * Helper utilities: session key building, noise filtering, message extraction.
 */
export declare function buildSessionKey(ctx: {
    sessionKey?: string;
    agentId?: string;
}): string;
export declare function isNoise(text: string, patterns: string[]): boolean;
export interface ExtractedMessage {
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
}
/**
 * Extract messages from the raw OpenClaw agent_end event.
 * Handles both string content and object content with a text/image/type shape.
 */
export declare function extractMessages(rawMessages: unknown[], noisePatterns: string[], ownerObserveOthers: boolean): ExtractedMessage[];
//# sourceMappingURL=helpers.d.ts.map