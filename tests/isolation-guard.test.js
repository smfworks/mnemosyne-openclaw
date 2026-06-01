import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

/**
 * Structural isolation guard.
 *
 * Agent/session scoping is only safe if it is enforced in exactly one place. This
 * test fails the build if any source file OTHER than the data-access layer
 * (src/dal.ts) or the schema definition (src/database.ts) issues SQL against the
 * content tables (messages / memories / their FTS shadows). It is the backstop
 * that keeps a future "just one quick query" from silently re-opening the
 * cross-agent leak we fixed in the v1.2.0 security pass.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

// Files permitted to touch the content tables directly.
const ALLOWED = new Set(["dal.ts", "database.ts"]);

// Raw content-table access patterns. \b after the table name keeps "messages"
// from matching inside "messages_fts" (which has its own dedicated pattern).
const FORBIDDEN = [
  { re: /\bFROM\s+messages\b/i, label: "FROM messages" },
  { re: /\bFROM\s+memories\b/i, label: "FROM memories" },
  { re: /\bINTO\s+messages\b/i, label: "INSERT INTO messages" },
  { re: /\bINTO\s+memories\b/i, label: "INSERT INTO memories" },
  { re: /\bUPDATE\s+messages\b/i, label: "UPDATE messages" },
  { re: /\bUPDATE\s+memories\b/i, label: "UPDATE memories" },
  { re: /\bmessages_fts\b/i, label: "messages_fts" },
  { re: /\bmemories_fts\b/i, label: "memories_fts" },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("no source file outside the DAL touches the content tables", () => {
  const violations = [];
  for (const file of walk(srcDir)) {
    const rel = relative(srcDir, file).replace(/\\/g, "/");
    if (ALLOWED.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    for (const { re, label } of FORBIDDEN) {
      if (re.test(text)) violations.push(`${rel}: ${label}`);
    }
  }
  assert.deepStrictEqual(
    violations,
    [],
    `Content-table SQL found outside src/dal.ts. Route it through ScopedStore instead:\n  ${violations.join("\n  ")}`
  );
});

test("the DAL itself still owns the content-table SQL (guard is wired up)", () => {
  const dal = readFileSync(join(srcDir, "dal.ts"), "utf8");
  // Sanity: if someone deletes the DAL's queries, the guard above would pass
  // vacuously. Assert the scoped queries are actually present here.
  assert.match(dal, /FROM memories_fts JOIN memories/, "agent-scoped FTS join present");
  assert.match(dal, /WHERE .*agent_id = \?/s, "agent_id filter present");
});
