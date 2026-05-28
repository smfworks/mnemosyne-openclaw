import { test } from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginState } from "../dist/state.js";
import { closeDatabase } from "../dist/database.js";
import {
  registerForgetTool,
  registerListTool,
  registerRecallTool,
  registerRememberTool,
} from "../dist/tools/index.js";

const TEST_DB = join(tmpdir(), "mnemosyne-tools-test.db");

function cleanDb() {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(TEST_DB + suffix); } catch { /* not exists */ }
  }
}

function createState() {
  cleanDb();
  const state = createPluginState({
    dbPath: TEST_DB,
    enableFts: true,
    maxMemoriesPerSession: 100,
  });
  state.ensureInitialized();
  return state;
}

test("agent-scoped memories are visible across sessions for the same agent", async () => {
  const state = createState();
  const sessionA = { sessionKey: "session-a", agentId: "agent-1" };
  const sessionB = { sessionKey: "session-b", agentId: "agent-1" };

  await registerRememberTool(state, sessionA).execute("call-1", {
    key: "favorite color",
    value: "blue",
    scope: "agent",
  });

  const recalled = await registerRecallTool(state, sessionB).execute("call-2", {
    key: "favorite_color",
  });

  assert.match(recalled.content[0].text, /favorite_color: blue \(agent\)/);
  cleanDb();
});

test("session memories override agent memories in recall order", async () => {
  const state = createState();
  const ctx = { sessionKey: "session-a", agentId: "agent-1" };

  await registerRememberTool(state, ctx).execute("call-1", {
    key: "timezone",
    value: "UTC",
    scope: "agent",
  });
  await registerRememberTool(state, ctx).execute("call-2", {
    key: "timezone",
    value: "America/New_York",
    scope: "session",
  });

  const recalled = await registerRecallTool(state, ctx).execute("call-3", {
    key: "timezone",
    limit: 2,
  });

  const text = recalled.content[0].text;
  assert.ok(text.indexOf("America/New_York (session)") < text.indexOf("UTC (agent)"));
  cleanDb();
});

test("forget can delete both session and agent scoped memories", async () => {
  const state = createState();
  const ctx = { sessionKey: "session-a", agentId: "agent-1" };

  await registerRememberTool(state, ctx).execute("call-1", { key: "project", value: "alpha", scope: "agent" });
  await registerRememberTool(state, ctx).execute("call-2", { key: "project", value: "beta", scope: "session" });
  await registerForgetTool(state, ctx).execute("call-3", { key: "project", scope: "all" });

  const listed = await registerListTool(state, ctx).execute("call-4", {});
  assert.match(listed.content[0].text, /No memories stored yet/);
  cleanDb();
});
