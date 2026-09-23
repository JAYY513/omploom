import { statSync } from "fs";
import { basename } from "path";
import { readModelsConfig, type ModelsFileConfig } from "./omp/models-config";
import { forEachFileLineSync, invalidateSessionFileListCache } from "./omp/session-files";
import { isRecord } from "./type-guards";
import { computeActiveSpanMs } from "./usage-metrics";
import {
  calculateCacheSavings,
  calculateUsageCost,
  resolveModelRates,
} from "./usage-rates";
import { getUsageReportFromDb } from "./usage-db";
import type {
  UsageAgentKind,
  UsageQueryOptions,
  UsageRecord,
  UsageReport,
  UsageSessionStat,
  UsageTimeRange,
} from "./usage-types";

/** Cached parse of ONE transcript, keyed by path + (mtime, size, agent). */
export interface ParsedTranscript {
  records: UsageRecord[];
  stat: UsageSessionStat;
}

interface SessionUsageCacheEntry {
  mtimeMs: number;
  size: number;
  agent: UsageAgentKind;
  profile: string;
  parsed: ParsedTranscript;
}

export const MAX_USAGE_CACHE_ENTRIES = 2000;
export const MAX_USAGE_CACHE_BYTES = 64 * 1024 * 1024; // 64 MiB

let usageCacheApproxBytes = 0;

declare global {
  var __ompUsageCache: Map<string, SessionUsageCacheEntry> | undefined;
}

function getUsageCache(): Map<string, SessionUsageCacheEntry> {
  if (!globalThis.__ompUsageCache) {
    globalThis.__ompUsageCache = new Map();
  }
  return globalThis.__ompUsageCache;
}

function estimateUsageEntryBytes(entry: SessionUsageCacheEntry): number {
  return entry.parsed.records.length * 200 + 128;
}

function setUsageCacheEntry(filePath: string, entry: SessionUsageCacheEntry): void {
  const cache = getUsageCache();
  const existing = cache.get(filePath);
  if (existing) {
    usageCacheApproxBytes -= estimateUsageEntryBytes(existing);
  }
  const entryBytes = estimateUsageEntryBytes(entry);
  cache.set(filePath, entry);
  usageCacheApproxBytes += entryBytes;

  while (cache.size > MAX_USAGE_CACHE_ENTRIES || usageCacheApproxBytes > MAX_USAGE_CACHE_BYTES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    const old = cache.get(oldestKey);
    if (old) usageCacheApproxBytes -= estimateUsageEntryBytes(old);
    cache.delete(oldestKey);
  }
}

/** Clear in-memory usage cache (useful on session mutation or manual refresh). */
export function invalidateUsageCache(): void {
  globalThis.__ompUsageCache?.clear();
  usageCacheApproxBytes = 0;
}

/**
 * Format a Date object to "YYYY-MM-DD" in local time.
 */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Format a Date object to "YYYY-MM" in local time.
 */
export function toLocalMonthString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format date for short chart axis label: e.g. "Aug 3" or "2026-08".
 */
export function formatChartDateLabel(dateStr: string, isMonthly: boolean): string {
  if (isMonthly) {
    const parts = dateStr.split("-");
    if (parts.length >= 2) {
      const monthIdx = parseInt(parts[1], 10) - 1;
      return `${MONTH_NAMES[monthIdx] || parts[1]} ${parts[0]}`;
    }
    return dateStr;
  }
  const parts = dateStr.split("-");
  if (parts.length >= 3) {
    const monthIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    return `${MONTH_NAMES[monthIdx] || parts[1]} ${day}`;
  }
  return dateStr;
}

/**
 * Format full date for table display: e.g. "Aug 3, 2026".
 */
export function formatFullDateLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length >= 3) {
    const monthIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    return `${MONTH_NAMES[monthIdx] || parts[1]} ${day}, ${parts[0]}`;
  }
  return dateStr;
}

/**
 * Compute timestamp range [startMs, endMs] for a given time range preset.
 */
export function computeTimeRangeBounds(
  range: UsageTimeRange = "30d",
  now: number = Date.now(),
): { startMs: number; endMs: number } {
  const nowDate = new Date(now);
  const endMs = now;

  switch (range) {
    case "today": {
      const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
      return { startMs: todayStart, endMs };
    }
    case "7d": {
      return { startMs: now - 7 * 86400 * 1000, endMs };
    }
    case "30d": {
      return { startMs: now - 30 * 86400 * 1000, endMs };
    }
    case "90d": {
      return { startMs: now - 90 * 86400 * 1000, endMs };
    }
    case "month": {
      const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
      return { startMs: monthStart, endMs };
    }
    case "all": {
      return { startMs: 0, endMs };
    }
    default:
      return { startMs: now - 30 * 86400 * 1000, endMs };
  }
}

/** Timestamp for a message entry: message-level first, then entry-level, then
 * the session header / file mtime as a floor. */
function messageTimestamp(msgTimestamp: unknown, entryTimestamp: unknown, fallback: number): number {
  if (typeof msgTimestamp === "number" && Number.isFinite(msgTimestamp) && msgTimestamp > 0) {
    return msgTimestamp;
  }
  if (typeof entryTimestamp === "string") {
    const parsed = new Date(entryTimestamp).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof entryTimestamp === "number" && Number.isFinite(entryTimestamp) && entryTimestamp > 0) {
    return entryTimestamp;
  }
  return fallback;
}

/** Rollup for a transcript that has no model calls yet (or cannot be read). */
function emptySessionStat(
  filePath: string,
  agent: UsageAgentKind,
  profile: string,
  at = Date.now(),
): UsageSessionStat {
  return {
    sessionId: basename(filePath, ".jsonl"),
    sessionCwd: "",
    agent,
    profile,
    startedAt: at,
    endedAt: at,
    activeMs: 0,
    modelMs: 0,
    tokens: 0,
    cost: 0,
    messages: 0,
  };
}

/** Lines we decode. Everything else (tool results, attachments, thinking
 * blobs) is skipped unparsed — that is what keeps a cold sync of several
 * thousand transcripts to about a minute. */
const USAGE_LINE_KIND_RE = /"type"\s*:\s*"(message|session|model_change|model_usage)"/;

/** Build one usage row; null when the call recorded no tokens and no cost
 * (aborted or provider-rejected turns carry all-zero usage). */
function buildUsageRecord(args: {
  rawUsage: Record<string, unknown>;
  provider: string;
  model: string;
  timestamp: number;
  sessionId: string;
  sessionCwd: string;
  agent: UsageAgentKind;
  profile: string;
  durationMs: number;
  turnIndex: number;
  config: ModelsFileConfig;
}): UsageRecord | null {
  const { rawUsage } = args;
  const input = typeof rawUsage.input === "number" ? rawUsage.input : 0;
  const output = typeof rawUsage.output === "number" ? rawUsage.output : 0;
  const reasoning = typeof rawUsage.reasoning === "number"
    ? rawUsage.reasoning
    : typeof rawUsage.reasoningTokens === "number"
      ? rawUsage.reasoningTokens
      : typeof rawUsage.thoughtTokens === "number"
        ? rawUsage.thoughtTokens
        : 0;
  const cacheRead = typeof rawUsage.cacheRead === "number" ? rawUsage.cacheRead : 0;
  const cacheWrite = typeof rawUsage.cacheWrite === "number" ? rawUsage.cacheWrite : 0;
  const totalTokens = typeof rawUsage.totalTokens === "number"
    ? rawUsage.totalTokens
    : input + output + cacheRead + cacheWrite;

  const rates = resolveModelRates(args.provider, args.model, args.config);
  const { cost, quality } = calculateUsageCost(rawUsage, rates);
  if (totalTokens <= 0 && cost <= 0) return null;

  return {
    timestamp: args.timestamp,
    sessionId: args.sessionId,
    sessionCwd: args.sessionCwd,
    provider: args.provider,
    model: args.model,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost,
    cacheSavings: calculateCacheSavings(rawUsage, rates),
    costQuality: quality,
    agent: args.agent,
    profile: args.profile,
    durationMs: args.durationMs,
    // Aux calls that precede the first user prompt join turn 1: a transcript's
    // activity is never "turn 0".
    turnIndex: Math.max(1, args.turnIndex),
  };
}

/**
 * Parse ONE transcript into usage records plus its session rollup.
 *
 * `agent` classifies the transcript (main session / task subagent / advisor).
 * Usage accounting walks the sessions tree recursively, so subagent spend is
 * counted exactly once — from the subagent's own transcript — instead of being
 * inferred from the parent session's `task` tool result.
 *
 * Both `message` entries and `model_usage` entries count: the latter are the
 * auxiliary calls omp makes for a session (auto-thinking, judge, titles) and
 * they are billed the same way.
 *
 * Memoized on (path, size, mtimeMs, agent): re-reading an unchanged file
 * costs one stat.
 */
export function parseTranscriptUsage(
  filePath: string,
  agent: UsageAgentKind = "main",
  customModelsConfig = readModelsConfig(),
  profile = "",
): ParsedTranscript {
  let stats;
  try {
    stats = statSync(filePath);
    if (!stats.isFile() || stats.size === 0) {
      return { records: [], stat: emptySessionStat(filePath, agent, profile) };
    }
  } catch {
    return { records: [], stat: emptySessionStat(filePath, agent, profile) };
  }

  const cache = getUsageCache();
  const cached = cache.get(filePath);
  if (
    cached &&
    cached.mtimeMs === stats.mtimeMs &&
    cached.size === stats.size &&
    cached.agent === agent &&
    cached.profile === profile
  ) {
    return cached.parsed;
  }

  let sessionId = basename(filePath, ".jsonl");
  let sessionCwd = "";
  let headerTimestamp = stats.mtimeMs;
  let activeProvider = "";
  let activeModel = "";
  const records: UsageRecord[] = [];
  const turnTimestamps: number[] = [];
  let turnIndex = 0;

  try {
    forEachFileLineSync(filePath, (rawLine) => {
      if (!rawLine || rawLine.length < 20) return;
      const head = rawLine.length > 160 ? rawLine.slice(0, 160) : rawLine;
      const kind = USAGE_LINE_KIND_RE.exec(head);
      if (!kind) return;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawLine);
      } catch {
        return;
      }
      if (!isRecord(parsed)) return;

      const type = kind[1];

      if (type === "session") {
        if (typeof parsed.id === "string") sessionId = parsed.id;
        if (typeof parsed.cwd === "string") sessionCwd = parsed.cwd;
        if (typeof parsed.timestamp === "string") {
          const t = new Date(parsed.timestamp).getTime();
          if (!isNaN(t)) headerTimestamp = t;
        }
        return;
      }

      if (type === "model_change") {
        if (typeof parsed.provider === "string") activeProvider = parsed.provider;
        if (typeof parsed.modelId === "string") activeModel = parsed.modelId;
        if (typeof parsed.model === "string") {
          if (parsed.model.includes("/")) {
            const parts = parsed.model.split("/");
            activeProvider = parts[0];
            activeModel = parts.slice(1).join("/");
          } else {
            activeModel = parsed.model;
          }
        }
        return;
      }

      if (type === "model_usage") {
        // Auxiliary call: auto-thinking, judge, titles. Its timestamps stay out
        // of the chat span (they are not user turns), but its tokens count.
        const rawUsage = isRecord(parsed.usage) ? parsed.usage : undefined;
        if (!rawUsage) return;
        const record = buildUsageRecord({
          rawUsage,
          provider: typeof parsed.provider === "string" && parsed.provider ? parsed.provider : (activeProvider || "unknown"),
          model: typeof parsed.model === "string" && parsed.model ? parsed.model : (activeModel || "unknown"),
          timestamp: messageTimestamp(parsed.timestamp, undefined, headerTimestamp),
          sessionId,
          sessionCwd,
          agent,
          profile,
          durationMs: 0,
          turnIndex,
          config: customModelsConfig,
        });
        if (record) records.push(record);
        return;
      }

      if (!isRecord(parsed.message)) return;
      const msg = parsed.message;
      const role = msg.role;
      // User turns bound the conversation; assistant turns carry the model
      // calls. Tool results are deliberately ignored (bulk + no new turn).
      if (role !== "assistant" && role !== "user") return;

      const timestamp = messageTimestamp(msg.timestamp, parsed.timestamp, headerTimestamp);
      turnTimestamps.push(timestamp);
      // A user prompt opens a new task turn; branch siblings answering the
      // same prompt stay inside it.
      if (role === "user") turnIndex += 1;
      if (role !== "assistant") return;

      const rawUsage = isRecord(msg.usage) ? msg.usage : undefined;
      if (!rawUsage) return;

      const record = buildUsageRecord({
        rawUsage,
        provider: (typeof msg.provider === "string" && msg.provider) ? msg.provider : (activeProvider || "unknown"),
        model: (typeof msg.model === "string" && msg.model) ? msg.model : (activeModel || "unknown"),
        timestamp,
        sessionId,
        sessionCwd,
        agent,
        profile,
        durationMs: typeof msg.duration === "number" && Number.isFinite(msg.duration) && msg.duration > 0
          ? msg.duration
          : 0,
        turnIndex,
        config: customModelsConfig,
      });
      if (record) records.push(record);
    });
  } catch {
    // Return partially collected records on read error
  }

  const tokens = records.reduce((sum, record) => sum + record.totalTokens, 0);
  const cost = records.reduce((sum, record) => sum + record.cost, 0);
  const modelMs = records.reduce((sum, record) => sum + record.durationMs, 0);
  const startedAt = turnTimestamps.length > 0 ? Math.min(...turnTimestamps) : headerTimestamp;
  const endedAt = turnTimestamps.length > 0 ? Math.max(...turnTimestamps) : headerTimestamp;

  const parsedTranscript: ParsedTranscript = {
    records,
    stat: {
      sessionId,
      sessionCwd,
      agent,
      profile,
      startedAt,
      endedAt,
      // Engaged time, not wall clock: a session left open overnight must not
      // read as a 60-hour chat.
      activeMs: computeActiveSpanMs(turnTimestamps.map((timestamp) => ({ timestamp }))),
      modelMs,
      tokens,
      cost,
      // Conversation turns (user + assistant entries), not model calls: this
      // is what the "longest chat" card reports next to the duration.
      messages: turnTimestamps.length,
    },
  };

  setUsageCacheEntry(filePath, {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    agent,
    profile,
    parsed: parsedTranscript,
  });

  return parsedTranscript;
}

/**
 * Generate full usage report over all sessions according to query options.
 * Backed by the persistent local SQLite usage database.
 */
export async function getUsageReport(options: UsageQueryOptions = {}): Promise<UsageReport> {
  if (options.forceRefresh) {
    invalidateUsageCache();
    invalidateSessionFileListCache();
  }
  return getUsageReportFromDb(options);
}
