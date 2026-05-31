/**
 * Helper utilities: session key building, noise filtering, message extraction.
 */
export function buildSessionKey(ctx) {
    if (ctx.sessionKey)
        return ctx.sessionKey;
    if (ctx.sessionId)
        return ctx.sessionId;
    return `agent_${ctx.agentId ?? "main"}_default`;
}
export function isNoise(text, patterns) {
    if (!text || typeof text !== "string")
        return true;
    const t = text.trim();
    if (!t)
        return true;
    for (const p of patterns) {
        // Anchored match: only drop turns that START with a noise marker, so a real
        // turn that merely quotes "[system]" or "[heartbeat]" mid-text is preserved.
        if (t.startsWith(p))
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
        // Do not persist system-role messages: system prompts / injected system
        // content can carry sensitive instructions or secrets that would otherwise
        // become locally searchable via FTS and recall.
        if (role === "system")
            continue;
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
            timestamp: sanitizeTimestamp(msg.timestamp),
        });
    }
    return out;
}
/**
 * Accept only a finite timestamp within a sane window (not negative, not far in
 * the future). Out-of-range values fall back to now so they can't corrupt the
 * timestamp-ordered prune. One day of forward skew is tolerated for clock drift.
 */
function sanitizeTimestamp(input) {
    const now = Date.now();
    if (typeof input !== "number" || !Number.isFinite(input))
        return now;
    if (input <= 0 || input > now + 24 * 60 * 60 * 1000)
        return now;
    return Math.trunc(input);
}
//# sourceMappingURL=helpers.js.map