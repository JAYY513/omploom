/**
 * Pure, IO-free derivations for the usage dashboard: the activity heatmap,
 * streaks, peak day and session durations.
 *
 * Everything here is a function of its arguments (including `today`), so the
 * numbers can be unit-tested against a fixed clock and reused on both the
 * server and the client without a second implementation.
 */

export type HeatmapMode = "daily" | "weekly" | "cumulative";

/** One day of usage, keyed by local calendar day ("YYYY-MM-DD"). */
export interface DailyActivityPoint {
  day: string;
  tokens: number;
  cost: number;
}

export interface HeatmapCell {
  /** Local calendar day ("YYYY-MM-DD"). */
  day: string;
  /** Value under the active mode (day / week / cumulative tokens). */
  value: number;
  /** 0 = nothing, 1-4 = intensity bucket against the mode's max. */
  level: 0 | 1 | 2 | 3 | 4;
  /** False for days after `today`: rendered as an empty placeholder. */
  inWindow: boolean;
}

export interface HeatmapWeek {
  cells: HeatmapCell[];
}

export interface HeatmapMonthLabel {
  /** Column index (0-based) the label sits above. */
  weekIndex: number;
  /** Pre-localized short month name, e.g. "6月" / "Jun". */
  label: string;
}

export interface HeatmapModel {
  weeks: HeatmapWeek[];
  monthLabels: HeatmapMonthLabel[];
  /** Max value under the active mode; 0 when there is no usage. */
  max: number;
  /** Sum of every day's tokens inside the window (mode-independent). */
  totalTokens: number;
}

export interface StreakSummary {
  /** Consecutive active days ending today or yesterday. */
  current: number;
  longest: number;
}

export interface SessionSpanInput {
  timestamp: number;
}

/** Default idle gap: silence longer than this does not count toward a chat's
 * duration (a session left open overnight must not read as 60 hours). */
export const DEFAULT_IDLE_GAP_MS = 30 * 60 * 1000;

/** Trailing window a heatmap covers: 53 weeks, matching a year view. */
export const HEATMAP_WEEKS = 53;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local "YYYY-MM-DD" for a timestamp (never UTC: streaks are calendar days). */
export function toLocalDayKey(value: number | Date): string {
  const d = typeof value === "number" ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local midnight of the day containing `value`. */
export function startOfLocalDay(value: number | Date): Date {
  const d = typeof value === "number" ? new Date(value) : new Date(value.getTime());
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addLocalDays(value: number | Date, days: number): Date {
  const d = startOfLocalDay(value);
  d.setDate(d.getDate() + days);
  return d;
}

/** Whole days between two local calendar days (b - a), DST-safe. */
export function diffLocalDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const utcA = Date.UTC(ay, (am || 1) - 1, ad || 1);
  const utcB = Date.UTC(by, (bm || 1) - 1, bd || 1);
  return Math.round((utcB - utcA) / DAY_MS);
}

/** Index points by day, summing duplicates (a day may arrive in several rows). */
function indexByDay(points: readonly DailyActivityPoint[]): Map<string, DailyActivityPoint> {
  const byDay = new Map<string, DailyActivityPoint>();
  for (const point of points) {
    const existing = byDay.get(point.day);
    if (existing) {
      existing.tokens += point.tokens;
      existing.cost += point.cost;
    } else {
      byDay.set(point.day, { day: point.day, tokens: point.tokens, cost: point.cost });
    }
  }
  return byDay;
}

function levelFor(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const bucket = Math.ceil((value / max) * 4);
  return Math.min(4, Math.max(1, bucket)) as 1 | 2 | 3 | 4;
}

/**
 * Build the trailing activity grid. Columns are weeks (Sunday-first rows), the
 * last column contains `today`, and days after `today` stay empty placeholders
 * so the grid keeps its rectangle.
 */
export function buildActivityHeatmap(
  points: readonly DailyActivityPoint[],
  options: {
    mode?: HeatmapMode;
    weeks?: number;
    today?: number | Date;
    /** Localized short month names, index 0 = January. */
    monthNames?: readonly string[];
  } = {},
): HeatmapModel {
  const mode = options.mode ?? "daily";
  const weeks = Math.max(1, options.weeks ?? HEATMAP_WEEKS);
  const today = startOfLocalDay(options.today ?? Date.now());
  const monthNames = options.monthNames;

  const byDay = indexByDay(points);

  // Column 0 is the Sunday that starts the earliest covered week.
  const lastColumnStart = addLocalDays(today, -today.getDay());
  const firstColumnStart = addLocalDays(lastColumnStart, -(weeks - 1) * 7);
  const windowStartKey = toLocalDayKey(firstColumnStart);

  // Weekly totals drive the "weekly" mode; cumulative runs over the window.
  const weekTotals = new Map<string, number>();
  let max = 0;
  let totalTokens = 0;

  const cellsByStart = new Map<string, HeatmapCell[]>();
  for (let w = 0; w < weeks; w += 1) {
    cellsByStart.set(toLocalDayKey(addLocalDays(firstColumnStart, w * 7)), []);
  }

  for (let w = 0; w < weeks; w += 1) {
    const columnStart = addLocalDays(firstColumnStart, w * 7);
    const columnStartKey = toLocalDayKey(columnStart);
    const cells = cellsByStart.get(columnStartKey);
    if (!cells) continue;

    let weekTotal = 0;
    for (let d = 0; d < 7; d += 1) {
      const dayDate = addLocalDays(columnStart, d);
      const day = toLocalDayKey(dayDate);
      const inWindow = dayDate.getTime() <= today.getTime() && day >= windowStartKey;
      const point = byDay.get(day);
      const tokens = inWindow ? (point?.tokens ?? 0) : 0;
      weekTotal += tokens;
      totalTokens += tokens;
      cells.push({ day, value: 0, level: 0, inWindow });
    }
    weekTotals.set(columnStartKey, weekTotal);
  }

  let cumulative = 0;
  for (let w = 0; w < weeks; w += 1) {
    const columnStart = addLocalDays(firstColumnStart, w * 7);
    const cells = cellsByStart.get(toLocalDayKey(columnStart));
    if (!cells) continue;
    const weekTotal = weekTotals.get(toLocalDayKey(columnStart)) ?? 0;
    for (const cell of cells) {
      if (!cell.inWindow) continue;
      const daily = byDay.get(cell.day)?.tokens ?? 0;
      cumulative += daily;
      if (mode === "daily") cell.value = daily;
      else if (mode === "weekly") cell.value = weekTotal;
      else cell.value = cumulative;
      if (cell.value > max) max = cell.value;
    }
  }

  const orderedWeeks: HeatmapWeek[] = [];
  for (let w = 0; w < weeks; w += 1) {
    const key = toLocalDayKey(addLocalDays(firstColumnStart, w * 7));
    orderedWeeks.push({ cells: cellsByStart.get(key) ?? [] });
  }

  const monthLabels: HeatmapMonthLabel[] = [];
  if (monthNames) {
    let lastMonth = -1;
    for (let w = 0; w < weeks; w += 1) {
      const columnStart = addLocalDays(firstColumnStart, w * 7);
      const month = columnStart.getMonth();
      if (month === lastMonth) continue;
      lastMonth = month;
      monthLabels.push({ weekIndex: w, label: monthNames[month] ?? String(month + 1) });
    }
  }

  for (const week of orderedWeeks) {
    for (const cell of week.cells) {
      cell.level = cell.inWindow ? levelFor(cell.value, max) : 0;
    }
  }

  return { weeks: orderedWeeks, monthLabels, max, totalTokens };
}

/** Current and longest run of consecutive active days. */
export function computeStreaks(days: Iterable<string>, today: number | Date = Date.now()): StreakSummary {
  const unique = Array.from(new Set(days)).sort();
  if (unique.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i += 1) {
    run = diffLocalDays(unique[i - 1], unique[i]) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const todayKey = toLocalDayKey(today);
  const last = unique[unique.length - 1];
  const gap = diffLocalDays(last, todayKey);
  // Today counts while the day is still running; a run ending yesterday is
  // still "current" — an unbroken chain the user can continue today.
  let current = 0;
  if (gap === 0 || gap === 1) {
    current = 1;
    for (let i = unique.length - 1; i > 0; i -= 1) {
      if (diffLocalDays(unique[i - 1], unique[i]) !== 1) break;
      current += 1;
    }
  }
  return { current, longest: Math.max(longest, current) };
}

/** Day with the most tokens; null when there is no usage. */
export function pickPeakDay(points: readonly DailyActivityPoint[]): DailyActivityPoint | null {
  let peak: DailyActivityPoint | null = null;
  for (const point of points) {
    if (!peak || point.tokens > peak.tokens) peak = { ...point };
  }
  return peak && peak.tokens > 0 ? peak : null;
}

/**
 * Chat duration: first message to last, dropping idle gaps longer than
 * `idleGapMs`. A session parked overnight therefore reports its engaged time,
 * not its wall-clock span.
 */
export function computeActiveSpanMs(
  entries: readonly SessionSpanInput[],
  idleGapMs: number = DEFAULT_IDLE_GAP_MS,
): number {
  const stamps = entries
    .map((entry) => entry.timestamp)
    .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (stamps.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < stamps.length; i += 1) {
    const gap = stamps[i] - stamps[i - 1];
    if (gap > 0 && gap <= idleGapMs) total += gap;
  }
  return total;
}

/** Zero-fill a day series over [startMs, endMs] so chart x-axes stay uniform. */
export function fillDailySeries(
  points: readonly DailyActivityPoint[],
  startMs: number,
  endMs: number,
): DailyActivityPoint[] {
  const byDay = indexByDay(points);
  const series: DailyActivityPoint[] = [];
  const start = startOfLocalDay(startMs);
  const end = startOfLocalDay(endMs);
  for (let day = start; day.getTime() <= end.getTime(); day = addLocalDays(day, 1)) {
    const key = toLocalDayKey(day);
    series.push(byDay.get(key) ?? { day: key, tokens: 0, cost: 0 });
  }
  return series;
}

const CJK_UNITS: readonly [number, string][] = [
  [1e12, "万亿"],
  [1e8, "亿"],
  [1e4, "万"],
];

const LATIN_UNITS: readonly [number, string][] = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/**
 * Compact token counts: CJK locales group by 万/亿 (matching how the numbers
 * are read locally), everything else by K/M/B.
 */
export function formatCompactTokens(value: number, locale?: string | null): string {
  if (value == null || !Number.isFinite(value)) return "0";
  const negative = value < 0;
  const abs = Math.abs(value);
  const cjk = locale === "zh-CN" || locale === "ja";
  const units = cjk ? CJK_UNITS : LATIN_UNITS;
  for (const [scale, suffix] of units) {
    if (abs < scale) continue;
    const scaled = abs / scale;
    const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1);
    return `${negative ? "-" : ""}${text.replace(/\.0$/, "")}${suffix}`;
  }
  return `${negative ? "-" : ""}${abs.toLocaleString()}`;
}

/**
 * Human duration split into at most two non-zero units ("1 小时 15 分钟").
 * `parts` supplies the localized unit names so this stays i18n-agnostic.
 */
export function formatDurationParts(
  ms: number,
  parts: { day: string; hour: string; minute: string; second: string },
): string[] {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const units: [number, string][] = [
    [days, parts.day],
    [hours, parts.hour],
    [minutes, parts.minute],
    [seconds, parts.second],
  ];

  const out: string[] = [];
  for (const [value, label] of units) {
    if (value > 0) out.push(`${value}${label}`);
    if (out.length === 2) break;
  }
  // Sub-second activity reads as "0秒" rather than an empty string.
  return out.length > 0 ? out : [`0${parts.second}`];
}

/** Model usage rows are grouped by (provider, model): the same model id can be
 * served by several providers, so the row identity includes the provider and
 * the label only spells it out when it is needed to tell two rows apart. */
export interface ModelUsageInput {
  model: string;
  provider: string;
  tokens: number;
  cost: number;
  /** Mean net-new tokens per task (one task = one user prompt). */
  avgTokensPerTask: number;
  /** Mean cost per task; tie-break for the per-task orderings. */
  avgCostPerTask: number;
  /** Lower median net-new tokens per task. */
  medianTokensPerTask: number;
  /** Tasks (user prompts) this model took part in. */
  taskCount: number;
}

export interface RankedModelUsage<T extends ModelUsageInput> {
  row: T;
  key: string;
  label: string;
  /** Share of the heaviest model in the list, 0-100 (bar width). */
  shareOfMax: number;
}

/** Active ordering for the model-usage list. */
export type ModelSortKey = "tokens" | "cost" | "taskAvg" | "taskMedian" | "taskCost" | "taskCount";

type ModelSortMetric =
  | "tokens"
  | "cost"
  | "avgTokensPerTask"
  | "avgCostPerTask"
  | "medianTokensPerTask"
  | "taskCount";

/** Primary then tie-break metric per ordering: cost-first falls back to
 * tokens, tokens-first falls back to cost, the per-task orderings fall back to
 * avg tokens per task (cost-per-task falls back to it too, so equal prices put
 * the bigger eater first). */
const MODEL_SORT_KEYS: Record<ModelSortKey, readonly [ModelSortMetric, ModelSortMetric]> = {
  tokens: ["tokens", "cost"],
  cost: ["cost", "tokens"],
  taskAvg: ["avgTokensPerTask", "avgCostPerTask"],
  taskMedian: ["medianTokensPerTask", "avgTokensPerTask"],
  taskCost: ["avgCostPerTask", "avgTokensPerTask"],
  taskCount: ["taskCount", "avgTokensPerTask"],
};

/** Rank models by the active sort key (default tokens). The bars always draw
 * the same metric the list is ordered by: a cost-ordered list under
 * token-proportional bars would read as unsorted. */
export function rankModelUsage<T extends ModelUsageInput>(
  rows: readonly T[],
  sortBy: ModelSortKey = "tokens",
): Array<RankedModelUsage<T>> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.model, (counts.get(row.model) ?? 0) + 1);
  const [primary, secondary] = MODEL_SORT_KEYS[sortBy];
  const max = rows.reduce((value, row) => Math.max(value, row[primary]), 0);
  return rows
    .slice()
    .sort((a, b) => b[primary] - a[primary] || b[secondary] - a[secondary] || a.model.localeCompare(b.model))
    .map((row) => ({
      row,
      key: `${row.provider}:${row.model}`,
      label: (counts.get(row.model) ?? 0) > 1 ? `${row.model} · ${row.provider}` : row.model,
      shareOfMax: max > 0 ? (row[primary] / max) * 100 : 0,
    }));
}
