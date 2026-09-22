/**
 * Background usage sync.
 *
 * A cold history is gigabytes of JSONL; parsing it inside an HTTP request
 * would hold a browser tab open for a minute. The dashboard therefore starts
 * this job, polls `/api/usage` for progress, and renders whatever the database
 * already holds in the meantime.
 *
 * Only one sync runs per process; concurrent callers share it. State lives on
 * `globalThis` for the same reason the RPC registry does — Next.js hot reload
 * otherwise silently drops the in-flight flag and starts a second job.
 */

import { invalidateUsageCache } from "./usage-service";
import { listUsageSessionRoots } from "./omp/paths";
import { getUsageDatabase, syncUsageFiles } from "./usage-db";
import { readModelsConfig } from "./omp/models-config";
import type { UsageSyncStatus } from "./usage-types";

export type UsageSyncState = UsageSyncStatus;

interface UsageSyncRegistry {
  state: UsageSyncState;
  job: Promise<void> | null;
}

declare global {
  var __ompUsageSync: UsageSyncRegistry | undefined;
}

function getIdleState(): UsageSyncState {
  return {
    running: false,
    phase: "idle",
    processed: 0,
    total: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

function getRegistry(): UsageSyncRegistry {
  if (!globalThis.__ompUsageSync) {
    globalThis.__ompUsageSync = { state: getIdleState(), job: null };
  }
  return globalThis.__ompUsageSync;
}

export function getUsageSyncState(): UsageSyncState {
  return { ...getRegistry().state };
}

export function isUsageSyncRunning(): boolean {
  return getRegistry().state.running;
}

async function runSync(reset: boolean): Promise<void> {
  const registry = getRegistry();
  const state = registry.state;
  state.phase = "collecting";
  state.error = null;

  try {
    if (reset) {
      const db = getUsageDatabase();
      db.exec("DELETE FROM synced_files; DELETE FROM usage_records; DELETE FROM session_stats;");
      invalidateUsageCache();
    }

    state.phase = "syncing";
    state.processed = 0;

    await syncUsageFiles({
      sources: listUsageSessionRoots(),
      modelsConfig: readModelsConfig(),
      onProgress: (progress) => {
        state.processed = progress.processed;
        state.total = progress.total;
      },
    });
    state.processed = state.total;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.running = false;
    state.phase = "idle";
    state.finishedAt = Date.now();
    registry.job = null;
  }
}

/**
 * Start a sync unless one is already running. Returns the current state
 * immediately — callers never block on the parse.
 */
export function startUsageSync(options: { reset?: boolean } = {}): UsageSyncState {
  const registry = getRegistry();
  if (registry.state.running) return getUsageSyncState();

  registry.state = {
    ...getIdleState(),
    running: true,
    phase: "collecting",
    startedAt: Date.now(),
  };
  registry.job = runSync(Boolean(options.reset));
  return getUsageSyncState();
}
