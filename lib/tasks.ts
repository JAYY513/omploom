import type { TodoPhase, WebSessionState } from "./pi-types";
import type { SessionInfo } from "./types";
import type { TaskUsageSummary } from "./usage-db";

/** Server-side cap: the board is a recent-activity view, not an archive. */
export const TASKS_LIST_MAX = 300;

/** Live get_state snapshot for one running session (null when unavailable). */
export interface TaskLiveSummary {
  modelProvider: string;
  modelId: string;
  modelName: string;
  queuedMessageCount: number;
  contextPercent: number | null;
  contextTokens: number | null;
  contextWindow: number | null;
  tokensPerSecond: number | null;
  isCompacting: boolean;
  todoDone: number;
  todoTotal: number;
}

/** One board row: session identity + running flag + usage + live snapshot. */
export interface TaskRow extends SessionInfo {
  running: boolean;
  usage: TaskUsageSummary | null;
  live: TaskLiveSummary | null;
}

export function countTodoTasks(phases: TodoPhase[] | undefined): { done: number; total: number } {
  if (!phases || phases.length === 0) return { done: 0, total: 0 };
  let done = 0;
  let total = 0;
  for (const phase of phases) {
    for (const task of phase.tasks ?? []) {
      total += 1;
      if (task.status === "completed") done += 1;
    }
  }
  return { done, total };
}

/** Extract the board's live fields from a WebSessionState; never throws. */
export function buildTaskLive(state: WebSessionState): TaskLiveSummary {
  const { done, total } = countTodoTasks(state.todoPhases);
  return {
    modelProvider: state.model?.provider ?? "",
    modelId: state.model?.id ?? "",
    modelName: state.model?.name ?? "",
    queuedMessageCount: typeof state.queuedMessageCount === "number" ? state.queuedMessageCount : 0,
    contextPercent: state.contextUsage?.percent ?? null,
    contextTokens: state.contextUsage?.tokens ?? null,
    contextWindow: state.contextUsage?.contextWindow ?? null,
    tokensPerSecond: state.tokensPerSecond ?? null,
    isCompacting: state.isCompacting === true,
    todoDone: done,
    todoTotal: total,
  };
}

/**
 * Sort by modified desc, truncate to `max`, and pin running sessions that
 * fell outside the window. Running ids with no file on disk yet (brand-new
 * session before the first flush) get a synthetic row so the board shows
 * them immediately, mirroring the sidebar's optimistic placeholders.
 */
export function selectTaskSessions(
  sessions: SessionInfo[],
  running: Array<{ id: string; cwd: string }>,
  max: number = TASKS_LIST_MAX,
  nowIso: string = new Date().toISOString(),
): { selected: SessionInfo[]; truncated: boolean } {
  const known = new Set(sessions.map((s) => s.id));
  const placeholders: SessionInfo[] = [];
  for (const r of running) {
    if (!r.id || known.has(r.id)) continue;
    placeholders.push({
      path: "",
      id: r.id,
      cwd: r.cwd ?? "",
      created: nowIso,
      modified: nowIso,
      messageCount: 0,
      firstMessage: "",
      projectRoot: r.cwd ?? "",
    });
  }
  const all = placeholders.length > 0 ? [...sessions, ...placeholders] : [...sessions];
  all.sort((a, b) => b.modified.localeCompare(a.modified));
  if (all.length <= max) return { selected: all, truncated: false };
  const runningIds = new Set(running.map((r) => r.id));
  const head = all.slice(0, max);
  const headIds = new Set(head.map((s) => s.id));
  const pinned = all.filter((s) => runningIds.has(s.id) && !headIds.has(s.id));
  return { selected: [...head, ...pinned], truncated: true };
}

/** Cap on the dimmed "recently read" tail in the attention view. */
export const TASKS_RECENT_CAP = 8;
/** Rows per project card in the "by project" view (expanded cards show all). */
export const TASKS_CARD_PREVIEW_ROWS = 3;

/**
 * Attention queue split. `review` is sticky: finished sessions the user has
 * not opened stay here until opened (caller feeds localStorage unread ids),
 * never auto-expiring. `read` is the dimmed tail of already-opened sessions.
 */
export function splitAttentionQueue(
  tasks: TaskRow[],
  unreadIds: ReadonlySet<string>,
  recentCap: number = TASKS_RECENT_CAP,
): { running: TaskRow[]; review: TaskRow[]; read: TaskRow[] } {
  const running = tasks.filter((s) => s.running).sort((a, b) => a.created.localeCompare(b.created));
  const rest = tasks.filter((s) => !s.running);
  const review = rest
    .filter((s) => unreadIds.has(s.id))
    .sort((a, b) => b.modified.localeCompare(a.modified));
  const reviewIds = new Set(review.map((s) => s.id));
  const read = rest
    .filter((s) => !reviewIds.has(s.id))
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .slice(0, Math.max(0, recentCap));
  return { running, review, read };
}

export interface TaskProjectGroup {
  key: string;
  label: string;
  branch: string | null;
  rows: TaskRow[];
  runningCount: number;
  reviewCount: number;
}

/**
 * Group rows for the "by project" view. Caller passes labelOf so the helper
 * stays free of UI imports; keys fold case for Windows/NTFS path spellings.
 * running/review counts feed the hot-first card order and the per-card chips.
 */
export function groupTasksByProject(
  rows: readonly TaskRow[],
  labelOf: (root: string) => string,
  unreadIds: ReadonlySet<string> = new Set(),
): TaskProjectGroup[] {
  const map = new Map<string, TaskProjectGroup>();
  for (const row of rows) {
    const root = row.projectRoot ?? row.cwd ?? "";
    const key = root.toLowerCase();
    let group = map.get(key);
    if (!group) {
      group = { key, label: labelOf(root || row.cwd || ""), branch: row.worktreeBranch ?? null, rows: [], runningCount: 0, reviewCount: 0 };
      map.set(key, group);
    }
    group.rows.push(row);
    if (row.running) group.runningCount += 1;
    else if (unreadIds.has(row.id)) group.reviewCount += 1;
    if (!group.branch && row.worktreeBranch) group.branch = row.worktreeBranch;
  }
  for (const group of map.values()) {
    group.rows.sort((a, b) => b.modified.localeCompare(a.modified));
  }
  // Cards with something to look at first; the rest alphabetically.
  return [...map.values()].sort((a, b) => {
    const aHot = a.runningCount > 0 || a.reviewCount > 0 ? 0 : 1;
    const bHot = b.runningCount > 0 || b.reviewCount > 0 ? 0 : 1;
    if (aHot !== bHot) return aHot - bHot;
    return a.label.localeCompare(b.label);
  });
}

/** The three lanes of the attention board, in display order. */
export type TaskColumnId = "running" | "review" | "read";

const TASKS_COLUMN_IDS: readonly TaskColumnId[] = ["running", "review", "read"];

/**
 * Toolbar filter (project chip + title search). `projectKey` is a case-folded
 * project-root key (as produced by groupTasksByProject); null means all
 * projects. `query` matches the card title (name, else first message, else id).
 */
export function filterTaskRows(
  rows: readonly TaskRow[],
  projectKey: string | null,
  query: string,
): TaskRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (projectKey !== null && (row.projectRoot ?? row.cwd ?? "").toLowerCase() !== projectKey) {
      return false;
    }
    if (q !== "") {
      const title = (row.name?.trim() || row.firstMessage || row.id).toLowerCase();
      if (!title.includes(q)) return false;
    }
    return true;
  });
}

/** Live stopwatch text for a running card: "0:41", "12:05", "1:22:33". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Collapsed attention columns persist per browser. Corrupted or unknown
 * stored ids degrade to "nothing collapsed".
 */
export function parseCollapsedColumns(raw: string | null | undefined): Set<TaskColumnId> {
  const out = new Set<TaskColumnId>();
  if (!raw) return out;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const id of parsed) {
        if (typeof id === "string" && (TASKS_COLUMN_IDS as readonly string[]).includes(id)) {
          out.add(id as TaskColumnId);
        }
      }
    }
  } catch {
    // corrupted storage behaves like "nothing collapsed"
  }
  return out;
}

export function serializeCollapsedColumns(collapsed: ReadonlySet<TaskColumnId>): string {
  return JSON.stringify(TASKS_COLUMN_IDS.filter((id) => collapsed.has(id)));
}

/**
 * Disk liveness for sessions omp-loom did not spawn (a terminal omp run is
 * invisible to the RPC registry). omp flushes the transcript on every
 * committed entry, so a fresh statSync mtime means "outputting right now".
 * Single model turns and tool calls can leave the file silent for a minute
 * or more (verified against a real run: user entry → ~40s tool gap → tool
 * result flush), so once a file was seen writing it stays running until
 * TASKS_DISK_STAY_MS passes without a write; otherwise a finished run
 * ghost-runs for at most TASKS_DISK_FRESH_MS.
 */
export interface TaskDiskActivityEntry {
  mtimeMs: number;
  observedAt: number;
  running: boolean;
}

/** A transcript written within this window is actively streaming. */
export const TASKS_DISK_FRESH_MS = 30_000;
/** Silence window a promoted file may ride out before demotion. */
export const TASKS_DISK_STAY_MS = 180_000;

/**
 * Decide disk-running per observed path. Callers stat recently modified
 * transcripts (bounded by their own list cache) and keep `snapshot` in a
 * hot-reload-safe store; `prev` supplies the was-running state from the
 * previous observation. Entries absent from `stats` are simply dropped —
 * a file that leaves the recent-modified candidate set has been quiet for
 * longer than the stay window, so it is demoted anyway.
 */
export function computeDiskRunningSessions(
  stats: ReadonlyArray<{ path: string; mtimeMs: number }>,
  prev: ReadonlyMap<string, TaskDiskActivityEntry>,
  nowMs: number,
): { runningPaths: Set<string>; snapshot: Map<string, TaskDiskActivityEntry> } {
  const runningPaths = new Set<string>();
  const snapshot = new Map<string, TaskDiskActivityEntry>();
  for (const { path: filePath, mtimeMs } of stats) {
    const wasRunning = prev.get(filePath)?.running === true;
    const quietFor = nowMs - mtimeMs;
    const running = quietFor <= TASKS_DISK_FRESH_MS
      || (wasRunning && quietFor <= TASKS_DISK_STAY_MS);
    if (running) runningPaths.add(filePath);
    snapshot.set(filePath, { mtimeMs, observedAt: nowMs, running });
  }
  return { runningPaths, snapshot };
}

/**
 * Group a lane's rows by project for the grouped view. Within-group order
 * and first-seen group order preserve the lane's own sort (created asc for
 * running, modified desc otherwise), so grouping never reshuffles priority;
 * keys fold case for Windows/NTFS spellings like groupTasksByProject.
 */
export interface LaneProjectGroup {
  key: string;
  label: string;
  rows: TaskRow[];
}

export function groupLaneRowsByProject(
  rows: readonly TaskRow[],
  labelOf: (root: string) => string,
): LaneProjectGroup[] {
  const map = new Map<string, LaneProjectGroup>();
  for (const row of rows) {
    const root = row.projectRoot ?? row.cwd ?? "";
    const key = root.toLowerCase();
    let group = map.get(key);
    if (!group) {
      group = { key, label: labelOf(root || row.cwd || ""), rows: [] };
      map.set(key, group);
    }
    group.rows.push(row);
  }
  return [...map.values()];
}

/**
 * Deterministic per-project dot color for the task board. Data-encoding
 * colors (same role as PROVIDER_COLORS in usage-rates): muted palette,
 * hashed on the case-folded project root so the same workspace always gets
 * the same dot and distinct workspaces usually differ.
 */
const PROJECT_DOT_COLORS = [
  "#D97706",
  "#10B981",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
  "#F59E0B",
  "#06B6D4",
  "#A855F7",
  "#64748B",
];

export function projectDotColor(key: string): string {
  const s = (key ?? "").toLowerCase();
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return PROJECT_DOT_COLORS[Math.abs(hash) % PROJECT_DOT_COLORS.length];
}
