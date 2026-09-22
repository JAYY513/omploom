import type { TranscriptAgent } from "./omp/session-files";

export type UsageTimeRange = "today" | "7d" | "30d" | "90d" | "month" | "all";
export type UsageGranularity = "daily" | "monthly" | "projects";
export type UsageMetricView = "cost" | "tokens";
export type UsageBreakdownView = "model" | "day" | "project";
export type CostQualityTier = "provider_reported" | "model_priced" | "unpriced";
export type UsageAgentKind = TranscriptAgent;

export interface ModelRates {
  input: number;      // USD per million tokens
  output: number;     // USD per million tokens
  cacheRead: number;  // USD per million tokens
  cacheWrite: number; // USD per million tokens
}

export interface UsageRecord {
  timestamp: number;
  sessionId: string;
  sessionCwd: string;
  provider: string;
  model: string;
  input: number;        // uncached input tokens
  output: number;       // output tokens
  reasoning: number;    // reasoning / thought tokens
  cacheRead: number;    // prompt cache read tokens
  cacheWrite: number;   // prompt cache write tokens
  totalTokens: number;
  cost: number;         // USD
  cacheSavings: number; // USD
  costQuality: CostQualityTier;
  /** Which agent made the model call: main session, task subagent, advisor. */
  agent: UsageAgentKind;
  /** omp profile the transcript belongs to ("" = default profile). */
  profile: string;
  /** Wall-clock duration of the model call in ms (0 when unreported). */
  durationMs: number;
}

/** Per-transcript rollup: one row per session file, subagents included. */
export interface UsageSessionStat {
  sessionId: string;
  sessionCwd: string;
  agent: UsageAgentKind;
  /** omp profile the transcript belongs to ("" = default profile). */
  profile: string;
  startedAt: number;
  endedAt: number;
  /** Engaged time: first message to last, idle gaps dropped. */
  activeMs: number;
  /** Sum of the model calls' own durations. */
  modelMs: number;
  tokens: number;
  cost: number;
  messages: number;
}

/** One day of usage (local calendar day). */
export interface UsageActivityPoint {
  day: string;
  tokens: number;
  cost: number;
  requests: number;
}

export interface UsageStreakSummary {
  currentDays: number;
  longestDays: number;
}

/** All-time headline numbers for the usage dashboard. Independent of the
 * selected time range: the hero row, heatmap and streaks never rescope. */
export interface UsageOverview {
  generatedAt: number;
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  activeDays: number;
  /** Tokens with no price on file: the cost total excludes them. */
  unpricedTokens: number;
  peakDay: UsageActivityPoint | null;
  longestSession: UsageSessionStat | null;
  streaks: UsageStreakSummary;
  /** Token/cost split so subagent spend is visible without a second view. */
  byAgent: Array<{ agent: UsageAgentKind; tokens: number; cost: number; requests: number }>;
  /** Token/cost split per omp profile; one entry when only the default is used. */
  byProfile: Array<{ profile: string; tokens: number; cost: number; requests: number }>;
  /** Sparse daily buckets covering the heatmap window (newest last). */
  activity: UsageActivityPoint[];
}

export interface UsageSummary {
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheSavings: number;
  activeDays: number;
  tokensPerActiveDay: number;
  cachePercentage: number;
  costQuality: {
    providerReported: number; // percentage 0-100
    modelPriced: number;      // percentage 0-100
    unpriced: number;         // percentage 0-100
  };
}

export interface ProviderUsageSummary {
  provider: string;
  name: string;
  cost: number;
  tokens: number;
  share: number; // 0-100 percentage of total cost (or total tokens if total cost is 0)
  color: string;
}

export interface ModelUsageSummary {
  model: string;
  provider: string;
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  share: number; // 0-100 percentage
  recordsCount: number;
}

export interface TimeSeriesPoint {
  date: string; // ISO format: "YYYY-MM-DD" or "YYYY-MM"
  label: string; // e.g. "Aug 3", "Sep 1", "2026-08"
  timestamp: number;
  totalCost: number;
  totalTokens: number;
  byProvider: Record<string, { cost: number; tokens: number }>;
}

export interface DayUsageSummary {
  date: string; // "YYYY-MM-DD"
  label: string; // e.g. "Aug 3, 2026"
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  share: number; // 0-100 percentage
}

export interface ProjectUsageSummary {
  project: string; // directory path
  projectName: string; // display folder name
  cost: number;
  tokens: number;
  share: number; // 0-100 percentage
  sessionsCount: number;
}

export interface UsageReportScanInfo {
  transcriptsScanned: number;
  transcriptsOutsideWindow: number;
  usageRecordsCount: number;
  durationSeconds: number;
  scannedAt: number;
}

export interface UsageReport {
  timeRange: UsageTimeRange;
  granularity: UsageGranularity;
  summary: UsageSummary;
  providers: ProviderUsageSummary[];
  timeSeries: TimeSeriesPoint[];
  modelBreakdown: ModelUsageSummary[];
  dayBreakdown: DayUsageSummary[];
  projectBreakdown: ProjectUsageSummary[];
  /** All-time dashboard block (hero stats, streaks, heatmap window). */
  overview: UsageOverview;
  scanInfo: UsageReportScanInfo;
}

export interface UsageQueryOptions {
  range?: UsageTimeRange;
  granularity?: UsageGranularity;
  project?: string;
  from?: number;
  to?: number;
  /** Drop the synced table + caches and re-parse everything. */
  forceRefresh?: boolean;
  /** Query only: used while a background sync owns the event loop. */
  skipSync?: boolean;
}

export type UsageSyncPhase = "idle" | "collecting" | "syncing";

/** Progress of the background sync, mirrored on every usage response so the
 * dashboard can show a progress bar without a second request shape. */
export interface UsageSyncStatus {
  running: boolean;
  phase: UsageSyncPhase;
  processed: number;
  total: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

export interface UsageReportResponse extends UsageReport {
  sync: UsageSyncStatus;
}
