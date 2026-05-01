/**
 * Helper utilities: session key building, noise filtering, message extraction.
 */
export function buildSessionKey(ctx) {
    if (ctx.sessionKey)
        return ctx.sessionKey;
    return `agent_${ctx.agentId ?? "main"}_default`;
}
export function isNoise(text, patterns) {
    if (!text || typeof text !== "string")
        return true;
    const t = text.trim();
    if (!t)
        return true;
    for (const p of patterns) {
        if (t.includes(p))
            return true;
    }
    return false;
}
/**
 * Extract messages from the raw OpenClaw agent_end event.
 * Handles both string content and object content with a text/image/type shape.
 */
export function extractMessages(rawMessages, noisePatterns, ownerObserveOthers) {
    const out = [];
    for (const m of rawMessages) {
        if (!m || typeof m !== "object")
            continue;
        const msg = m;
        const rawRole = String(msg.role ?? "").toLowerCase();
        const role = rawRole === "user"
            ? "user"
            : rawRole === "system"
                ? "system"
                : "assistant";
        let content = "";
        if (typeof msg.content === "string") {
            content = msg.content;
        }
        else if (Array.isArray(msg.content)) {
            // Anthropic-style array content
            content = msg.content
                .filter((c) => c && typeof c === "object")
                .map((c) => (typeof c.text === "string" ? c.text : ""))
                .join("");
        }
        else if (msg.text && typeof msg.text === "string") {
            content = msg.text;
        }
        if (!content.trim())
            continue;
        if (isNoise(content, noisePatterns))
            continue;
        if (!ownerObserveOthers && role === "user")
            continue;
        out.push({
            role,
            content,
            timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
        });
    }
    return out;
}
//# sourceMappingURL=helpers.js.map