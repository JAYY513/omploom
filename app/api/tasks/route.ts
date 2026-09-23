import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { statSync } from "fs";
import { listAllSessions } from "@/lib/session-reader";
import { getRegistrySessionIds, getRpcSession, getRunningRpcSessions } from "@/lib/rpc-manager";
import { getTaskUsageForFiles, getUsageDatabase, hasSyncedUsage } from "@/lib/usage-db";
import { toLocalDayKey } from "@/lib/usage-metrics";
import {
  buildTaskLive,
  computeDiskRunningSessions,
  selectTaskSessions,
  type TaskDiskActivityEntry,
  type TaskLiveSummary,
  type TaskRow,
} from "@/lib/tasks";
import type { WebSessionState } from "@/lib/pi-types";

// The task board mixes on-disk sessions with the live running set, so it
// must never be cached by proxies or the browser. An ETag still lets
// conditional GETs short-circuit to 304 (same contract as /api/sessions).
const TASKS_LIST_HEADERS = {
  "Cache-Control": "no-store",
  Vary: "Cookie",
} as const;

declare global {
  var __ompTaskDiskActivity: Map<string, TaskDiskActivityEntry> | undefined;
}

/** Previous disk-activity observation, shared across requests so the
 * stay-running grace survives between fetches (and hot reloads). */
function getDiskActivitySnapshot(): Map<string, TaskDiskActivityEntry> {
  return (globalThis.__ompTaskDiskActivity ??= new Map());
}

/** A session whose listed mtime is older than this cannot be running under
 * the stay-grace window, so it is never stat'd. */
const TASKS_DISK_CANDIDATE_WINDOW_MS = 5 * 60_000;

/** Live get_state for one running wrapper; null when unavailable. */
async function readLiveState(sessionId: string): Promise<TaskLiveSummary | null> {
  const wrapper = getRpcSession(sessionId);
  if (!wrapper || !wrapper.isAlive()) return null;
  try {
    const state = (await wrapper.send({ type: "get_state" })) as WebSessionState;
    return buildTaskLive(state);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const nowMs = Date.now();
    const sessions = await listAllSessions();
    const running = getRunningRpcSessions();
    const runningIds = new Set(running.map((r) => r.id));

    // Disk liveness for sessions omp-loom did not spawn: a terminal omp run
    // never enters the RPC registry, but it flushes its transcript on every
    // committed entry, so a fresh mtime means "outputting right now". Only
    // recently modified files are stat'd (bounded), and ids with a live
    // wrapper are excluded — the wrapper is authoritative for those.
    const registryIds = new Set(getRegistrySessionIds());
    const diskStats: Array<{ path: string; mtimeMs: number }> = [];
    for (const s of sessions) {
      if (!s.path || registryIds.has(s.id)) continue;
      if (nowMs - Date.parse(s.modified) >= TASKS_DISK_CANDIDATE_WINDOW_MS) continue;
      try {
        diskStats.push({ path: s.path, mtimeMs: statSync(s.path).mtimeMs });
      } catch {
        // vanished file — not running
      }
    }
    const { runningPaths, snapshot } = computeDiskRunningSessions(diskStats, getDiskActivitySnapshot(), nowMs);
    globalThis.__ompTaskDiskActivity = snapshot;
    const diskRunningIds = new Set(
      sessions.filter((s) => s.path !== "" && runningPaths.has(s.path)).map((s) => s.id),
    );
    const allRunningIds = new Set([...runningIds, ...diskRunningIds]);
    const { selected, truncated } = selectTaskSessions(
      sessions,
      [...allRunningIds].map((id) => ({ id, cwd: "" })),
    );

    // Read-only usage lookup against whatever the background sync has
    // indexed so far. A cold database yields null usage rows, never an
    // error — the board must not block on a first-time sync.
    let usageSynced = false;
    const usageByPath = new Map<string, NonNullable<TaskRow["usage"]>>();
    let today: { cost: number; tokens: number } | null = null;
    try {
      const db = getUsageDatabase();
      usageSynced = hasSyncedUsage(db);
      if (usageSynced) {
        for (const [path, summary] of getTaskUsageForFiles(db, selected.map((s) => s.path))) {
          usageByPath.set(path, summary);
        }
        // Machine-wide burn for the local calendar day (the materialized
        // `day` column is indexed). Covers every profile and subagent
        // transcript, unlike the per-row summaries which are main-only.
        const row = db
          .prepare(
            "SELECT COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(total_tokens), 0) AS tokens FROM usage_records WHERE day = ?",
          )
          .get(toLocalDayKey(Date.now())) as { cost: number; tokens: number } | undefined;
        if (row) today = { cost: row.cost, tokens: row.tokens };
      }
    } catch {
      // Usage index unreadable — rows render without token/cost data.
    }

    // Live state ONLY for sessions already in the RPC registry. Idle
    // sessions are never spawned for this board (no startRpcSession here).
    const liveById = new Map<string, TaskLiveSummary>();
    const liveReads = selected
      .filter((s) => runningIds.has(s.id))
      .map(async (s) => {
        const live = await readLiveState(s.id);
        if (live) liveById.set(s.id, live);
      });
    await Promise.all(liveReads);

    const tasks: TaskRow[] = selected.map((s) => ({
      ...s,
      running: allRunningIds.has(s.id),
      usage: (s.path && usageByPath.get(s.path)) || null,
      live: liveById.get(s.id) ?? null,
    }));
    // fetchedAt is excluded from the ETag hash: it changes on every request
    // while the content is identical, which would defeat conditional GETs.
    const payload = { tasks, truncated, usageSynced, today };
    const etag = `"${createHash("sha1").update(JSON.stringify(payload)).digest("hex").slice(0, 16)}"`;
    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag, ...TASKS_LIST_HEADERS } });
    }
    const bodyJson = JSON.stringify({ ...payload, fetchedAt: new Date().toISOString() });
    return new NextResponse(bodyJson, { headers: { ETag: etag, "Content-Type": "application/json", ...TASKS_LIST_HEADERS } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), code: "internal_error" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
