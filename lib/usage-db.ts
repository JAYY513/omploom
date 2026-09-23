import { existsSync, mkdirSync, statSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, join } from "path";
import { readModelsConfig, type ModelsFileConfig } from "./omp/models-config";
import { getAgentDir, listUsageSessionRoots, type UsageSessionRoot } from "./omp/paths";
import { classifyTranscriptAgent, listSessionTranscripts } from "./omp/session-files";
import {
  formatChartDateLabel,
  formatFullDateLabel,
  parseTranscriptUsage,
  toLocalDateString,
  toLocalMonthString,
  computeTimeRangeBounds,
} from "./usage-service";
import { computeStreaks, HEATMAP_WEEKS, toLocalDayKey } from "./usage-metrics";
import { getProviderColor, getProviderDisplayName } from "./usage-rates";
import type {
  DayUsageSummary,
  ModelUsageSummary,
  ProjectUsageSummary,
  ProviderUsageSummary,
  TimeSeriesPoint,
  UsageActivityPoint,
  UsageAgentKind,
  UsageOverview,
  UsageQueryOptions,
  UsageReport,
  UsageSessionStat,
  UsageSummary,
} from "./usage-types";

declare global {
  var __ompUsageDatabase: DatabaseSync | undefined;
  var __ompUsageDatabasePath: string | undefined;
}

/** Get the path to the usage SQLite database file (~/.omp/agent/usage.db). */
export function getUsageDbPath(): string {
  const dir = getAgentDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, "usage.db");
}

/**
 * Open or reuse the persistent SQLite database for usage tracking.
 */
export function getUsageDatabase(customPath?: string): DatabaseSync {
  const targetPath = customPath || getUsageDbPath();

  if (globalThis.__ompUsageDatabase && globalThis.__ompUsageDatabasePath === targetPath) {
    return globalThis.__ompUsageDatabase;
  }

  if (globalThis.__ompUsageDatabase) {
    try {
      globalThis.__ompUsageDatabase.close();
    } catch {
      // Ignore close error on re-init
    }
  }

  const dir = dirname(targetPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS synced_files (
      file_path TEXT PRIMARY KEY,
      mtime_ms REAL NOT NULL,
      file_size INTEGER NOT NULL,
      records_count INTEGER NOT NULL,
      synced_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      session_id TEXT NOT NULL,
      session_cwd TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      reasoning_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost REAL NOT NULL,
      cache_savings REAL NOT NULL,
      cost_quality TEXT NOT NULL,
      agent TEXT NOT NULL DEFAULT 'main',
      -- omp profile the transcript came from; '' is the default profile.
      profile TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      -- Local calendar day of the timestamp column. Materialized at write
      -- time: the dashboard's day rollups otherwise ran strftime() over every
      -- row on each request (seconds per call on a six-figure row count).
      day TEXT NOT NULL DEFAULT ''
    );


    -- One row per transcript: main sessions AND nested subagent/advisor
    -- transcripts, so the dashboard can rank chats and split agent spend.
    CREATE TABLE IF NOT EXISTS session_stats (
      file_path TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      session_cwd TEXT NOT NULL,
      agent TEXT NOT NULL,
      profile TEXT NOT NULL DEFAULT '',
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      active_ms INTEGER NOT NULL,
      model_ms INTEGER NOT NULL,
      tokens INTEGER NOT NULL,
      cost REAL NOT NULL,
      messages INTEGER NOT NULL
    );


    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  migrateUsageSchema(db);

  // Indexes come after the migrations: an index on a column that only the
  // migration adds (agent, day) would fail on a database created before it.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp ON usage_records(timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_records_file_path ON usage_records(file_path);
    CREATE INDEX IF NOT EXISTS idx_usage_records_provider ON usage_records(provider);
    CREATE INDEX IF NOT EXISTS idx_usage_records_session_cwd ON usage_records(session_cwd);
    CREATE INDEX IF NOT EXISTS idx_usage_records_agent ON usage_records(agent);
    CREATE INDEX IF NOT EXISTS idx_usage_records_day ON usage_records(day);
    CREATE INDEX IF NOT EXISTS idx_usage_records_profile ON usage_records(profile);

    CREATE INDEX IF NOT EXISTS idx_session_stats_agent_active ON session_stats(agent, active_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_session_stats_ended ON session_stats(ended_at);
  `);

  globalThis.__ompUsageDatabase = db;
  globalThis.__ompUsageDatabasePath = targetPath;
  return db;
}

/**
 * Bump whenever a change makes already-synced rows WRONG rather than merely
 * incomplete: the next sync then re-parses every transcript instead of
 * trusting `synced_files`. Version 1 introduced agent attribution
 * (main/subagent/advisor) and per-call durations — rows written before it
 * would otherwise keep the DEFAULT 'main' and silently fold subagent spend
 * into the parent session. Version 2 added profile attribution ('' = default
 * profile) so usage from `omp --profile <name>` trees is counted and labelled.
 */
const USAGE_SCHEMA_VERSION = 2;

function tableColumns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

/** Bring an existing usage database up to date in place. */
function migrateUsageSchema(db: DatabaseSync): void {
  const columns = tableColumns(db, "usage_records");
  let addedColumn = false;
  if (!columns.includes("agent")) {
    db.exec("ALTER TABLE usage_records ADD COLUMN agent TEXT NOT NULL DEFAULT 'main'");
    addedColumn = true;
  }
  if (!columns.includes("duration_ms")) {
    db.exec("ALTER TABLE usage_records ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0");
    addedColumn = true;
  }
  if (!columns.includes("day")) {
    db.exec("ALTER TABLE usage_records ADD COLUMN day TEXT NOT NULL DEFAULT ''");
    addedColumn = true;
  }
  if (!columns.includes("profile")) {
    db.exec("ALTER TABLE usage_records ADD COLUMN profile TEXT NOT NULL DEFAULT ''");
    addedColumn = true;
  }
  const sessionColumns = tableColumns(db, "session_stats");
  if (!sessionColumns.includes("profile")) {
    db.exec("ALTER TABLE session_stats ADD COLUMN profile TEXT NOT NULL DEFAULT ''");
    addedColumn = true;
  }

  const versionRow = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  const version = versionRow ? Number(versionRow.value) : 0;
  if (!addedColumn && version >= USAGE_SCHEMA_VERSION) return;

  db.exec("DELETE FROM synced_files; DELETE FROM usage_records; DELETE FROM session_stats;");
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(
    String(USAGE_SCHEMA_VERSION),
  );
}

/**
 * True once at least one transcript row exists, i.e. the dashboard can render
 * something real. A cold database is filled by the background sync instead of
 * inside the first request.
 */
export function hasSyncedUsage(db?: DatabaseSync): boolean {
  const database = db || getUsageDatabase();
  try {
    const row = database.prepare("SELECT COUNT(*) AS c FROM synced_files").get() as { c: number };
    return (row?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Close the usage database instance. */
export function closeUsageDatabase(): void {
  if (globalThis.__ompUsageDatabase) {
    try {
      globalThis.__ompUsageDatabase.close();
    } catch {
      // Ignore
    }
    globalThis.__ompUsageDatabase = undefined;
    globalThis.__ompUsageDatabasePath = undefined;
  }
}

export interface SyncStats {
  filesScanned: number;
  filesUpdated: number;
  filesDeleted: number;
  recordsInserted: number;
  sessionsWritten: number;
}

/** Files parsed between event-loop yields during a sync. */
const SYNC_YIELD_EVERY_FILES = 20;

export interface UsageSyncProgress {
  processed: number;
  total: number;
  file: string;
}

export interface UsageSyncInput {
  /** Every store that holds this machine's usage: the default profile plus
   * named profiles (`omp --profile <name>` writes to an isolated tree). */
  sources: UsageSessionRoot[];
  modelsConfig?: ModelsFileConfig;
  db?: DatabaseSync;
  onProgress?: (progress: UsageSyncProgress) => void;
}

/**
 * Incrementally sync every transcript into SQLite. Only files that are new or
 * whose (mtime, size) changed are re-parsed; deleted files are purged.
 *
 * The walk is recursive on purpose: subagent and advisor transcripts live in
 * each session's artifacts directory and carry their own model calls, so
 * skipping them undercounts spend by roughly a sixth on a subagent-heavy
 * history.
 */
export async function syncUsageFiles(input: UsageSyncInput): Promise<SyncStats> {
  const db = input.db || getUsageDatabase();
  const modelsConfig = input.modelsConfig ?? readModelsConfig();
  const now = Date.now();

  // Collect every transcript up front so progress can be reported against the
  // real total (each profile root is walked independently).
  const jobs: Array<{ filePath: string; sessionsRoot: string; profile: string }> = [];
  for (const source of input.sources) {
    for (const filePath of await listSessionTranscripts(source.sessionsRoot)) {
      jobs.push({ filePath, sessionsRoot: source.sessionsRoot, profile: source.profile });
    }
  }

  const syncedRows = db.prepare("SELECT file_path, mtime_ms, file_size FROM synced_files").all() as Array<{
    file_path: string;
    mtime_ms: number;
    file_size: number;
  }>;

  const syncedMap = new Map<string, { mtime_ms: number; file_size: number }>();
  for (const row of syncedRows) {
    syncedMap.set(row.file_path, { mtime_ms: row.mtime_ms, file_size: row.file_size });
  }

  const insertRecordStmt = db.prepare(`
    INSERT INTO usage_records (
      file_path, session_id, session_cwd, timestamp, provider, model,
      input_tokens, output_tokens, reasoning_tokens, cache_read_tokens,
      cache_write_tokens, total_tokens, cost, cache_savings, cost_quality,
      agent, profile, duration_ms, day
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);
  const insertSessionStmt = db.prepare(`
    INSERT OR REPLACE INTO session_stats (
      file_path, session_id, session_cwd, agent, profile, started_at, ended_at,
      active_ms, model_ms, tokens, cost, messages
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteRecordsStmt = db.prepare("DELETE FROM usage_records WHERE file_path = ?");
  const deleteSessionStmt = db.prepare("DELETE FROM session_stats WHERE file_path = ?");
  const deleteSyncedStmt = db.prepare("DELETE FROM synced_files WHERE file_path = ?");
  const upsertSyncedFileStmt = db.prepare(`
    INSERT OR REPLACE INTO synced_files (file_path, mtime_ms, file_size, records_count, synced_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  let filesUpdated = 0;
  let recordsInserted = 0;
  let sessionsWritten = 0;
  let processed = 0;
  const currentFilesSet = new Set<string>();

  const purgeFile = (filePath: string): void => {
    db.exec("BEGIN TRANSACTION;");
    try {
      deleteRecordsStmt.run(filePath);
      deleteSessionStmt.run(filePath);
      deleteSyncedStmt.run(filePath);
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
  };

  for (const job of jobs) {
    const { filePath, sessionsRoot, profile } = job;
    processed += 1;
    // Parsing is synchronous and a cold history is gigabytes of JSONL: yield
    // between batches so a background sync cannot stall the whole server
    // (progress reporting and every other request ride the same event loop).
    if (processed % SYNC_YIELD_EVERY_FILES === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    let stats;
    try {
      stats = statSync(filePath);
      if (!stats.isFile() || stats.size === 0) {
        // A truncated/emptied transcript must drop its rows, not keep them.
        if (syncedMap.has(filePath)) {
          purgeFile(filePath);
          filesUpdated += 1;
        }
        continue;
      }
    } catch {
      continue;
    }

    currentFilesSet.add(filePath);
    input.onProgress?.({ processed, total: jobs.length, file: filePath });

    const existing = syncedMap.get(filePath);
    if (existing && existing.mtime_ms === stats.mtimeMs && existing.file_size === stats.size) {
      continue;
    }

    const agent = classifyTranscriptAgent(sessionsRoot, filePath);
    const parsed = parseTranscriptUsage(filePath, agent, modelsConfig, profile);

    db.exec("BEGIN TRANSACTION;");
    try {
      deleteRecordsStmt.run(filePath);
      deleteSessionStmt.run(filePath);

      for (const record of parsed.records) {
        insertRecordStmt.run(
          filePath,
          record.sessionId,
          record.sessionCwd,
          record.timestamp,
          record.provider,
          record.model,
          record.input,
          record.output,
          record.reasoning,
          record.cacheRead,
          record.cacheWrite,
          record.totalTokens,
          record.cost,
          record.cacheSavings,
          record.costQuality,
          record.agent,
          record.profile,
          record.durationMs,
          toLocalDayKey(record.timestamp),
        );
        recordsInserted++;
      }

      const stat = parsed.stat;
      insertSessionStmt.run(
        filePath,
        stat.sessionId,
        stat.sessionCwd,
        stat.agent,
        stat.profile,
        stat.startedAt,
        stat.endedAt,
        stat.activeMs,
        stat.modelMs,
        stat.tokens,
        stat.cost,
        stat.messages,
      );
      sessionsWritten++;

      upsertSyncedFileStmt.run(filePath, stats.mtimeMs, stats.size, parsed.records.length, now);
      db.exec("COMMIT;");
      filesUpdated++;
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
  }

  // Purge transcripts that disappeared from the tree.
  let filesDeleted = 0;
  for (const filePath of syncedMap.keys()) {
    if (currentFilesSet.has(filePath) && existsSync(filePath)) continue;
    purgeFile(filePath);
    filesDeleted++;
  }

  return {
    filesScanned: jobs.length,
    filesUpdated,
    filesDeleted,
    recordsInserted,
    sessionsWritten,
  };
}

/**
 * All-time headline block for the usage dashboard. Range-independent by
 * design: the hero row, streaks and the heatmap window always describe the
 * whole history, while the trend/model cards follow the selected range.
 */
export function buildUsageOverview(db: DatabaseSync, now = Date.now()): UsageOverview {
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost), 0) AS cost,
              COUNT(*) AS requests,
              COALESCE(SUM(CASE WHEN cost_quality = 'unpriced' THEN total_tokens ELSE 0 END), 0) AS unpricedTokens
       FROM usage_records`,
    )
    .get() as { tokens: number; cost: number; requests: number; unpricedTokens: number };

  const byAgent = db
    .prepare(
      `SELECT agent,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost), 0) AS cost,
              COUNT(*) AS requests
       FROM usage_records
       GROUP BY agent
       ORDER BY tokens DESC`,
    )
    .all() as Array<{ agent: UsageAgentKind; tokens: number; cost: number; requests: number }>;

  // One entry per omp profile that has usage ('' = default profile).
  const byProfile = db
    .prepare(
      `SELECT profile,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost), 0) AS cost,
              COUNT(*) AS requests
       FROM usage_records
       GROUP BY profile
       ORDER BY tokens DESC`,
    )
    .all() as Array<{ profile: string; tokens: number; cost: number; requests: number }>;

  // Heatmap window: 53 week-columns ending in the current week.
  const today = new Date(now);
  const lastColumnStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  const firstColumnStart = new Date(lastColumnStart.getTime() - (HEATMAP_WEEKS - 1) * 7 * 86400000);

  const activity = db
    .prepare(
      `SELECT day,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost), 0) AS cost,
              COUNT(*) AS requests
       FROM usage_records
       WHERE timestamp >= ?
       GROUP BY day
       ORDER BY day ASC`,
    )
    .all(firstColumnStart.getTime()) as unknown as UsageActivityPoint[];

  const dayRows = db
    .prepare(
      `SELECT DISTINCT day FROM usage_records ORDER BY day ASC`,
    )
    .all() as Array<{ day: string }>;
  const activeDays = dayRows.length;
  const streakSummary = computeStreaks(dayRows.map((row) => row.day), now);

  const peakRow = db
    .prepare(
      `SELECT day,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(cost), 0) AS cost,
              COUNT(*) AS requests
       FROM usage_records
       GROUP BY day
       ORDER BY tokens DESC
       LIMIT 1`,
    )
    .get() as UsageActivityPoint | undefined;

  // Longest CHAT: subagent transcripts are not conversations, so they are out
  // of the running even though their tokens count everywhere else.
  const longestRow = db
    .prepare(
      `SELECT session_id, session_cwd, agent, profile, started_at, ended_at, active_ms,
              model_ms, tokens, cost, messages
       FROM session_stats
       WHERE agent = 'main'
       ORDER BY active_ms DESC
       LIMIT 1`,
    )
    .get() as
    | {
        session_id: string;
        session_cwd: string;
        agent: UsageAgentKind;
        profile: string;
        started_at: number;
        ended_at: number;
        active_ms: number;
        model_ms: number;
        tokens: number;
        cost: number;
        messages: number;
      }
    | undefined;

  const longestSession: UsageSessionStat | null = longestRow
    ? {
        sessionId: longestRow.session_id,
        sessionCwd: longestRow.session_cwd,
        agent: longestRow.agent,
        profile: longestRow.profile,
        startedAt: longestRow.started_at,
        endedAt: longestRow.ended_at,
        activeMs: longestRow.active_ms,
        modelMs: longestRow.model_ms,
        tokens: longestRow.tokens,
        cost: longestRow.cost,
        messages: longestRow.messages,
      }
    : null;

  return {
    generatedAt: now,
    totalTokens: totals.tokens,
    totalCost: totals.cost,
    totalRequests: totals.requests,
    unpricedTokens: totals.unpricedTokens,
    activeDays,
    peakDay: peakRow && peakRow.tokens > 0 ? peakRow : null,
    longestSession,
    streaks: { currentDays: streakSummary.current, longestDays: streakSummary.longest },
    byAgent,
    byProfile,
    activity,
  };
}
/** Per-file usage summary consumed by the tasks board (main transcript only). */
export interface TaskUsageSummary {
  tokens: number;
  cost: number;
  activeMs: number;
  modelMs: number;
  messages: number;
  startedAt: number;
  endedAt: number;
  /** Latest provider/model seen in this file's main-transcript records. */
  provider: string;
  model: string;
}

/**
 * Batch-read per-file usage for a bounded set of session files. Keyed by
 * file_path (the session_stats PK / an indexed usage_records column) so no
 * schema or index change is needed. Files without rows are simply absent.
 */
export function getTaskUsageForFiles(
  db: DatabaseSync,
  filePaths: readonly string[],
): Map<string, TaskUsageSummary> {
  const result = new Map<string, TaskUsageSummary>();
  const files = [...new Set(filePaths.filter((p) => typeof p === "string" && p.length > 0))];
  if (files.length === 0) return result;
  // Stay under SQLITE_LIMIT_VARIABLE_NUMBER on every chunk.
  for (let i = 0; i < files.length; i += 500) {
    const group = files.slice(i, i + 500);
    const placeholders = group.map(() => "?").join(",");
    const statRows = db.prepare(
      `SELECT file_path, started_at, ended_at, active_ms, model_ms, tokens, cost, messages
       FROM session_stats
       WHERE agent = 'main' AND file_path IN (${placeholders})`,
    ).all(...group) as Array<{
      file_path: string; started_at: number; ended_at: number; active_ms: number;
      model_ms: number; tokens: number; cost: number; messages: number;
    }>;
    for (const row of statRows) {
      result.set(row.file_path, {
        tokens: row.tokens,
        cost: row.cost,
        activeMs: row.active_ms,
        modelMs: row.model_ms,
        messages: row.messages,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        provider: "",
        model: "",
      });
    }
    const modelRows = db.prepare(
      `SELECT file_path, provider, model FROM (
         SELECT file_path, provider, model,
           ROW_NUMBER() OVER (PARTITION BY file_path ORDER BY timestamp DESC, rowid DESC) AS rn
         FROM usage_records
         WHERE agent = 'main' AND file_path IN (${placeholders})
       ) WHERE rn = 1`,
    ).all(...group) as Array<{ file_path: string; provider: string; model: string }>;
    for (const row of modelRows) {
      const existing = result.get(row.file_path);
      if (existing) {
        existing.provider = row.provider;
        existing.model = row.model;
      } else {
        result.set(row.file_path, {
          tokens: 0,
          cost: 0,
          activeMs: 0,
          modelMs: 0,
          messages: 0,
          startedAt: 0,
          endedAt: 0,
          provider: row.provider,
          model: row.model,
        });
      }
    }
  }
  return result;
}


/**
 * Execute SQL analytics queries over the SQLite database to generate a full UsageReport.
 */
export async function getUsageReportFromDb(
  options: UsageQueryOptions = {},
  customDb?: DatabaseSync,
): Promise<UsageReport> {
  const startTime = Date.now();
  const timeRange = options.range || "30d";
  const granularity = options.granularity || "daily";
  const projectFilter = options.project ? options.project.trim().toLowerCase() : undefined;

  const db = customDb || getUsageDatabase();
  if (options.forceRefresh) {
    try {
      db.exec("DELETE FROM synced_files; DELETE FROM usage_records; DELETE FROM session_stats;");
    } catch {
      // Ignore
    }
  }

  // Sync latest transcripts from disk before querying (main sessions plus the
  // nested subagent/advisor transcripts that carry their own usage, across the
  // default profile and every named profile). Skipped while a background sync
  // owns the job — the caller is then polling.
  if (!options.skipSync) {
    await syncUsageFiles({ sources: listUsageSessionRoots(), modelsConfig: readModelsConfig(), db });
  }
  const hasExplicitBounds =
    typeof options.from === "number" &&
    typeof options.to === "number" &&
    !isNaN(options.from) &&
    !isNaN(options.to);

  const { startMs, endMs } = hasExplicitBounds
    ? { startMs: options.from!, endMs: options.to! }
    : computeTimeRangeBounds(timeRange, startTime);

  // Build WHERE clause
  const params: (number | string)[] = [startMs, endMs];
  let whereProject = "";
  if (projectFilter) {
    whereProject = " AND LOWER(session_cwd) LIKE ? ";
    params.push(`%${projectFilter}%`);
  }

  // 1. Summary Query
  const summaryRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS usageRecordsCount,
        COALESCE(SUM(cost), 0) AS totalCost,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
        COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
        COALESCE(SUM(cache_savings), 0) AS cacheSavings,
        COUNT(DISTINCT day) AS activeDays,
        SUM(CASE WHEN cost_quality = 'provider_reported' THEN 1 ELSE 0 END) AS providerReportedCount,
        SUM(CASE WHEN cost_quality = 'model_priced' THEN 1 ELSE 0 END) AS modelPricedCount,
        SUM(CASE WHEN cost_quality = 'unpriced' THEN 1 ELSE 0 END) AS unpricedCount
      FROM usage_records
      WHERE timestamp >= ? AND timestamp <= ? ${whereProject}
    `,
    )
    .get(...params) as Record<string, number>;

  const totalCost = summaryRow?.totalCost ?? 0;
  const totalTokens = summaryRow?.totalTokens ?? 0;
  const inputTokens = summaryRow?.inputTokens ?? 0;
  const outputTokens = summaryRow?.outputTokens ?? 0;
  const reasoningTokens = summaryRow?.reasoningTokens ?? 0;
  const cacheReadTokens = summaryRow?.cacheReadTokens ?? 0;
  const cacheWriteTokens = summaryRow?.cacheWriteTokens ?? 0;
  const cacheSavings = summaryRow?.cacheSavings ?? 0;
  const activeDays = summaryRow?.activeDays ?? 0;
  const totalRecords = summaryRow?.usageRecordsCount ?? 0;

  const costQuality = {
    providerReported: totalRecords > 0 ? ((summaryRow.providerReportedCount || 0) / totalRecords) * 100 : 0,
    modelPriced: totalRecords > 0 ? ((summaryRow.modelPricedCount || 0) / totalRecords) * 100 : 0,
    unpriced: totalRecords > 0 ? ((summaryRow.unpricedCount || 0) / totalRecords) * 100 : 0,
  };

  const tokensPerActiveDay = activeDays > 0 ? Math.round(totalTokens / activeDays) : 0;
  const cachePercentage =
    cacheReadTokens + inputTokens > 0 ? (cacheReadTokens / (cacheReadTokens + inputTokens)) * 100 : 0;

  const summary: UsageSummary = {
    totalCost,
    totalTokens,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheSavings,
    activeDays,
    tokensPerActiveDay,
    cachePercentage,
    costQuality,
  };

  // 2. Providers Query
  const providerRows = db
    .prepare(
      `
      SELECT
        provider,
        COALESCE(SUM(cost), 0) AS cost,
        COALESCE(SUM(total_tokens), 0) AS tokens
      FROM usage_records
      WHERE timestamp >= ? AND timestamp <= ? ${whereProject}
      GROUP BY provider
      ORDER BY cost DESC, tokens DESC
    `,
    )
    .all(...params) as Array<{ provider: string; cost: number; tokens: number }>;

  const providers: ProviderUsageSummary[] = providerRows.map((row) => {
    const share =
      totalCost > 0
        ? (row.cost / totalCost) * 100
        : totalTokens > 0
          ? (row.tokens / totalTokens) * 100
          : 0;
    return {
      provider: row.provider,
      name: getProviderDisplayName(row.provider),
      cost: row.cost,
      tokens: row.tokens,
      share,
      color: getProviderColor(row.provider),
    };
  });

  // 3. Time Series Query
  const isMonthly = granularity === "monthly";
  // Daily buckets read the materialized `day` column; months still derive from
  // the timestamp (a month is 30x rarer than a day and needs no extra column).
  const bucketExpr = isMonthly
    ? "strftime('%Y-%m', timestamp / 1000, 'unixepoch', 'localtime')"
    : "day";

  const timeSeriesRows = db
    .prepare(
      `
      SELECT
        ${bucketExpr} AS bucketDate,
        provider,
        MIN(timestamp) AS minTimestamp,
        COALESCE(SUM(cost), 0) AS cost,
        COALESCE(SUM(total_tokens), 0) AS tokens
      FROM usage_records
      WHERE timestamp >= ? AND timestamp <= ? ${whereProject}
      GROUP BY bucketDate, provider
      ORDER BY bucketDate ASC
    `,
    )
    .all(...params) as Array<{
    bucketDate: string;
    provider: string;
    minTimestamp: number;
    cost: number;
    tokens: number;
  }>;

  const timeSeriesMap = new Map<
    string,
    {
      timestamp: number;
      totalCost: number;
      totalTokens: number;
      byProvider: Record<string, { cost: number; tokens: number }>;
    }
  >();

  // Continuous bucket interpolation (bounded to prevent multi-decade stalls)
  if (startMs > 0 && endMs >= startMs) {
    const cur = new Date(startMs);
    const end = new Date(endMs);
    const maxDailySpanMs = 730 * 86400 * 1000;
    const maxMonthlySpanMonths = 120;

    if (isMonthly) {
      cur.setDate(1);
      let monthsCount = 0;
      while (
        (cur <= end || toLocalMonthString(cur) === toLocalMonthString(end)) &&
        monthsCount < maxMonthlySpanMonths
      ) {
        const key = toLocalMonthString(cur);
        if (!timeSeriesMap.has(key)) {
          timeSeriesMap.set(key, {
            timestamp: cur.getTime(),
            totalCost: 0,
            totalTokens: 0,
            byProvider: {},
          });
        }
        cur.setMonth(cur.getMonth() + 1);
        monthsCount++;
      }
    } else {
      if (end.getTime() - cur.getTime() > maxDailySpanMs) {
        cur.setTime(end.getTime() - maxDailySpanMs);
      }
      let daysCount = 0;
      while ((cur <= end || toLocalDateString(cur) === toLocalDateString(end)) && daysCount < 730) {
        const key = toLocalDateString(cur);
        if (!timeSeriesMap.has(key)) {
          timeSeriesMap.set(key, {
            timestamp: cur.getTime(),
            totalCost: 0,
            totalTokens: 0,
            byProvider: {},
          });
        }
        cur.setDate(cur.getDate() + 1);
        daysCount++;
      }
    }
  }

  // Populate actual data points from SQL rows
  for (const row of timeSeriesRows) {
    const key = row.bucketDate;
    let bucket = timeSeriesMap.get(key);
    if (!bucket) {
      bucket = {
        timestamp: row.minTimestamp,
        totalCost: 0,
        totalTokens: 0,
        byProvider: {},
      };
      timeSeriesMap.set(key, bucket);
    }

    bucket.totalCost += row.cost;
    bucket.totalTokens += row.tokens;

    if (!bucket.byProvider[row.provider]) {
      bucket.byProvider[row.provider] = { cost: 0, tokens: 0 };
    }
    bucket.byProvider[row.provider].cost += row.cost;
    bucket.byProvider[row.provider].tokens += row.tokens;
  }

  const timeSeries: TimeSeriesPoint[] = Array.from(timeSeriesMap.entries())
    .map(([date, data]) => ({
      date,
      label: formatChartDateLabel(date, isMonthly),
      timestamp: data.timestamp,
      totalCost: data.totalCost,
      totalTokens: data.totalTokens,
      byProvider: data.byProvider,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 4. Model Breakdown Query
  const modelRows = db
    .prepare(
      `
      SELECT
        model,
        provider,
        COALESCE(SUM(cost), 0) AS cost,
        COALESCE(SUM(total_tokens), 0) AS tokens,
        COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
        COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
        COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens,
        COUNT(*) AS recordsCount
      FROM usage_records
      WHERE timestamp >= ? AND timestamp <= ? ${whereProject}
      GROUP BY model, provider
      ORDER BY cost DESC, tokens DESC
    `,
    )
    .all(...params) as Array<{
    model: string;
    provider: string;
    cost: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    recordsCount: number;
  }>;

  const modelBreakdown: ModelUsageSummary[] = modelRows.map((row) => ({
    ...row,
    share:
      totalCost > 0
        ? (row.cost / totalCost) * 100
        : totalTokens > 0
          ? (row.tokens / totalTokens) * 100
          : 0,
  }));

  // 5. Day Breakdown Query
  const dayRows = db
    .prepare(
      `
      SELECT
        day AS date,
        COALESCE(SUM(cost), 0) AS cost,
        COALESCE(SUM(total_tokens), 0) AS tokens,
        COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens
      FROM usage_records
      WHERE timestamp >= ? AND timestamp <= ? ${whereProject}
      GROUP BY date
      ORDER BY date DESC
    `,
    )
    .all(...params) as Array<{
    date: string;
    cost: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  }>;

  const dayBreakdown: DayUsageSummary[] = dayRows.map((row) => ({
    ...row,
    label: formatFullDateLabel(row.date),
    share:
      totalCost > 0
        ? (row.cost / totalCost) * 100
        : totalTokens > 0
          ? (row.tokens / totalTokens) * 100
          : 0,
  }));

  // 6. Project Breakdown Query
  const projectRows = db
    .prepare(
      `
      SELECT
        session_cwd AS project,
        COALESCE(SUM(cost), 0) AS cost,
        COALESCE(SUM(total_tokens), 0) AS tokens,
        COUNT(DISTINCT session_id) AS sessionsCount
      FROM usage_records
      WHERE timestamp >= ? AND timestamp <= ? ${whereProject}
      GROUP BY session_cwd
      ORDER BY cost DESC, tokens DESC
    `,
    )
    .all(...params) as Array<{
    project: string;
    cost: number;
    tokens: number;
    sessionsCount: number;
  }>;

  const projectBreakdown: ProjectUsageSummary[] = projectRows.map((row) => ({
    project: row.project || "Default Project",
    projectName: basename(row.project || "Default Project") || row.project,
    cost: row.cost,
    tokens: row.tokens,
    share:
      totalCost > 0
        ? (row.cost / totalCost) * 100
        : totalTokens > 0
          ? (row.tokens / totalTokens) * 100
          : 0,
    sessionsCount: row.sessionsCount,
  }));

  // Scan info
  const totalSyncedRow = db.prepare("SELECT COUNT(*) as c FROM synced_files").get() as { c: number };
  const inWindowSyncedRow = db
    .prepare(
      `
      SELECT COUNT(DISTINCT file_path) as c
      FROM usage_records
      WHERE timestamp >= ? AND timestamp <= ? ${whereProject}
    `,
    )
    .get(...params) as { c: number };

  const transcriptsScanned = totalSyncedRow?.c ?? 0;
  const transcriptsInWindow = inWindowSyncedRow?.c ?? 0;
  const transcriptsOutsideWindow = Math.max(0, transcriptsScanned - transcriptsInWindow);
  const durationSeconds = Math.max(0.001, (Date.now() - startTime) / 1000);
  const overview = buildUsageOverview(db, startTime);

  return {
    timeRange,
    granularity,
    summary,
    providers,
    timeSeries,
    modelBreakdown,
    dayBreakdown,
    projectBreakdown,
    overview,
    scanInfo: {
      transcriptsScanned,
      transcriptsOutsideWindow,
      usageRecordsCount: totalRecords,
      durationSeconds: parseFloat(durationSeconds.toFixed(3)),
      scannedAt: Date.now(),
    },
  };
}
