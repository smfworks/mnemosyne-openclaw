/**
 * Shared mutable plugin state — dependency-injected to every module.
 * Mirror of Honcho's PluginState pattern.
 */
import { MnemosyneConfig, validateConfig } from "./config.js";
import { getDatabase } from "./database.js";
import Database from "better-sqlite3";

export interface PluginState {
  cfg: MnemosyneConfig;
  db: InstanceType<typeof Database>;
  initialized: boolean;
  ensureInitialized(): void;
  resolveDefaultAgentId(): string;
}

export function createPluginState(rawConfig: unknown): PluginState {
  const cfg = validateConfig(rawConfig);
  const db = getDatabase(cfg);

  const state: PluginState = {
    cfg,
    db,
    initialized: false,
    ensureInitialized,
    resolveDefaultAgentId,
  };

  function resolveDefaultAgentId(): string {
    return "main";
  }

  function ensureInitialized(): void {
    if (state.initialized) return;
    state.initialized = true;
  }

  return state;
}
