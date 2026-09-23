"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  buildActivityHeatmap,
  formatCompactTokens,
  formatDurationParts,
  HEATMAP_WEEKS,
  rankModelUsage,
  type DailyActivityPoint,
  type HeatmapMode,
  type ModelSortKey,
} from "@/lib/usage-metrics";
import type { UsageReportResponse } from "@/lib/usage-types";

/** Ranges the dashboard offers; the hero row and heatmap stay all-time. */
const RANGES = ["7d", "30d", "all"] as const;
type RangeKey = (typeof RANGES)[number];

/** Poll cadence while a background sync owns the parse. */
const SYNC_POLL_MS = 1500;

const HEATMAP_MODES: HeatmapMode[] = ["daily", "weekly", "cumulative"];

/** Model rows shown before "show all"; a 30-day window easily holds 30+. */
const MODEL_PREVIEW_ROWS = 6;

/** Sort segment labels; each names the exact value the rows highlight. */
const SORT_LABEL_KEYS: Record<ModelSortKey, string> = {
  tokens: "usageStats.sortByTokens",
  cost: "usageStats.sortByCost",
  taskAvg: "usageStats.sortByTaskAvg",
  taskMedian: "usageStats.sortByTaskMedian",
  taskCost: "usageStats.sortByTaskCost",
  taskCount: "usageStats.sortByTaskCount",
};

/** The value the list is ordered by reads brighter, so the active sort is
 * legible from the rows alone. */
function sortedMetricStyle(active: boolean) {
  return active ? ({ color: "var(--text)", fontWeight: 600 } as const) : undefined;
}

const HEATMAP_LEVEL_COLORS = [
  "var(--bg-subtle)",
  "color-mix(in srgb, var(--accent) 22%, transparent)",
  "color-mix(in srgb, var(--accent) 45%, transparent)",
  "color-mix(in srgb, var(--accent) 70%, transparent)",
  "var(--accent)",
];

function formatCost(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(3)}`;
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface StatCard {
  key: string;
  value: string;
  label: string;
  hint?: string;
}

export function UsageStats({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();

  const [range, setRange] = useState<RangeKey>("7d");
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>("daily");
  const [showAllModels, setShowAllModels] = useState(false);
  const [modelSort, setModelSort] = useState<ModelSortKey>("tokens");
  const [report, setReport] = useState<UsageReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** A range switch is in flight (first visit of that range, or a forced
   * reload). Cached ranges flip instantly and never show this. */
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);
  /** One report per range. Each is seconds of aggregation on a large history,
   * so re-visiting a range must not pay for it again. */
  const reportCacheRef = useRef(new Map<RangeKey, UsageReportResponse>());

  const fetchRange = useCallback(async (target: RangeKey, signal?: AbortSignal) => {
    const res = await fetch(`/api/usage?range=${target}&granularity=daily`, { signal });
    if (!res.ok) throw new Error(`usage ${res.status}`);
    return (await res.json()) as UsageReportResponse;
  }, []);

  const load = useCallback(
    async (nextRange: RangeKey, signal?: AbortSignal, options: { force?: boolean } = {}) => {
      if (!options.force) {
        const cached = reportCacheRef.current.get(nextRange);
        if (cached) {
          setReport(cached);
          setError(null);
          setLoading(false);
          return;
        }
      }
      const seq = ++requestSeqRef.current;
      setSwitching(true);
      try {
        const data = await fetchRange(nextRange, signal);
        // A slow response from an older range must not overwrite a newer one.
        if (seq !== requestSeqRef.current) return;
        reportCacheRef.current.set(nextRange, data);
        setReport(data);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (seq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
          setSwitching(false);
        }
      }
    },
    [fetchRange],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(range, controller.signal);
    return () => controller.abort();
  }, [load, range]);

  // While a sync runs, keep asking for the freshest snapshot. The chain waits
  // for each response: a slow report must not stack overlapping requests.
  const syncRunning = report?.sync.running ?? false;
  useEffect(() => {
    if (!syncRunning) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      await load(range, undefined, { force: true });
      if (!cancelled) timer = window.setTimeout(tick, SYNC_POLL_MS);
    };
    timer = window.setTimeout(tick, SYNC_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [syncRunning, load, range]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/usage/sync", { method: "POST" });
      await load(range, undefined, { force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [load, range]);

  // Warm the other ranges in the background: the toggle then flips with no
  // wait at all, instead of costing a fresh aggregation per first visit.
  useEffect(() => {
    if (!report || report.sync.running) return;
    const missing = RANGES.filter((key) => !reportCacheRef.current.has(key));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const key of missing) {
        try {
          const data = await fetchRange(key);
          if (cancelled) return;
          reportCacheRef.current.set(key, data);
        } catch {
          // Prefetch is best-effort; the toggle still fetches on demand.
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [report, fetchRange]);

  const overview = report?.overview;
  const monthNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale || "en", { month: "short" });
    return Array.from({ length: 12 }, (_, month) => formatter.format(new Date(2026, month, 1)));
  }, [locale]);

  const heatmap = useMemo(
    () =>
      buildActivityHeatmap(overview?.activity ?? [], {
        mode: heatmapMode,
        weeks: HEATMAP_WEEKS,
        monthNames,
      }),
    [overview?.activity, heatmapMode, monthNames],
  );

  const durationUnits = useMemo(
    () => ({
      day: t("usageStats.unitDay"),
      hour: t("usageStats.unitHour"),
      minute: t("usageStats.unitMinute"),
      second: t("usageStats.unitSecond"),
    }),
    [t],
  );

  const trend = useMemo(() => {
    if (!report) return { points: [] as DailyActivityPoint[], total: 0, peak: 0 };
    const points: DailyActivityPoint[] = report.timeSeries.map((point) => ({
      day: point.date,
      tokens: point.totalTokens,
      cost: point.totalCost,
    }));
    const total = points.reduce((sum, point) => sum + point.tokens, 0);
    const peak = points.reduce((max, point) => Math.max(max, point.tokens), 0);
    return { points, total, peak };
  }, [report]);

  const modelRows = useMemo(
    () => rankModelUsage(report?.modelBreakdown ?? [], modelSort),
    [report?.modelBreakdown, modelSort],
  );

  const visibleModelRows = showAllModels ? modelRows : modelRows.slice(0, MODEL_PREVIEW_ROWS);
  /** Range total for the model card's header. Taken from the report summary —
   * the same SQL aggregate behind the hero row — rather than from summing the
   * rows here, which would round to a different cent.
   *
   * The card covers EVERY model in the range, not just the previewed ones. */
  const modelTotals = {
    tokens: report?.summary.totalTokens ?? 0,
    cost: report?.summary.totalCost ?? 0,
  };
  const rangeLabel =
    range === "7d" ? t("usageStats.range7d") : range === "30d" ? t("usageStats.range30d") : t("usageStats.rangeAll");

  const tokens = (value: number | undefined) => formatCompactTokens(value ?? 0, locale);
  /** First load with nothing to show yet: render placeholders, not an empty state. */
  const pending = loading && !report;
  const longest = overview?.longestSession ?? null;

  const statCards: StatCard[] = [
    {
      key: "totalTokens",
      value: tokens(overview?.totalTokens),
      label: t("usageStats.totalTokens"),
      hint:
        pending
          ? undefined
          : overview && overview.unpricedTokens > 0
          ? `${t("usageStats.totalCost", { cost: formatCost(overview.totalCost) })} · ${t("usageStats.unpricedNote", {
              tokens: tokens(overview.unpricedTokens),
            })}`
          : t("usageStats.totalCost", { cost: formatCost(overview?.totalCost ?? 0) }),
    },
    {
      key: "peakTokens",
      value: tokens(overview?.peakDay?.tokens),
      label: t("usageStats.peakTokens"),
      hint: overview?.peakDay ? overview.peakDay.day : t("usageStats.noData"),
    },
    {
      key: "longestChat",
      value: longest
        ? formatDurationParts(longest.activeMs, durationUnits).join(" ")
        : t("usageStats.noData"),
      label: t("usageStats.longestChat"),
      hint: longest ? t("usageStats.messageCount", { count: longest.messages }) : undefined,
    },
    {
      key: "currentStreak",
      value: t("usageStats.dayCount", { count: overview?.streaks.currentDays ?? 0 }),
      label: t("usageStats.currentStreak"),
    },
    {
      key: "longestStreak",
      value: t("usageStats.dayCount", { count: overview?.streaks.longestDays ?? 0 }),
      label: t("usageStats.longestStreak"),
      hint: t("usageStats.activeDays", { count: overview?.activeDays ?? 0 }),
    },
  ];

  const agentSplit = (overview?.byAgent ?? []).filter((row) => row.tokens > 0);
  // Named profiles are isolated state trees (`omp --profile <name>`); the split
  // only earns a line when more than one of them has usage.
  const profileSplit = (overview?.byProfile ?? []).filter((row) => row.tokens > 0);
  const subagentTokens = agentSplit
    .filter((row) => row.agent !== "main")
    .reduce((sum, row) => sum + row.tokens, 0);

  const cardStyle: React.CSSProperties = {
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-card)",
    boxShadow: "var(--shadow-card)",
    padding: 16,
  };

  const segmented = (options: Array<{ key: string; label: string; active: boolean; onClick: () => void }>) => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        background: "var(--bg-subtle)",
        borderRadius: "var(--radius-control)",
        padding: 2,
      }}
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={option.onClick}
          aria-pressed={option.active}
          style={{
            border: "none",
            background: option.active ? "var(--bg-selected)" : "transparent",
            color: option.active ? "var(--text)" : "var(--text-muted)",
            fontSize: 12,
            fontWeight: option.active ? 600 : 500,
            padding: "4px 10px",
            borderRadius: "var(--radius-control)",
            cursor: "pointer",
            transition: "background var(--dur-fast) var(--ease-out-warm)",
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        overflowY: "auto",
        background: "var(--bg)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        color: "var(--text)",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onClose}
          title={t("usageStats.back")}
          aria-label={t("usageStats.back")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: "var(--radius-control)",
            border: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <ArrowLeft size={15} />
        </button>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            fontFamily: "var(--font-serif, serif)",
            letterSpacing: "-0.01em",
          }}
        >
          {t("usageStats.title")}
        </h1>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "2px 10px",
          }}
        >
          {t("usageStats.badge")}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: "var(--text)",
            borderRadius: "var(--radius-control)",
            padding: "6px 12px",
            fontSize: 12,
            cursor: refreshing ? "default" : "pointer",
            opacity: refreshing ? 0.7 : 1,
          }}
        >
          {refreshing || syncRunning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {t("usageStats.refresh")}
        </button>
      </div>

      {/* Sync progress: a cold history is parsed in the background */}
      {report?.sync.running && (
        <div
          role="status"
          style={{
            ...cardStyle,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <Loader2 size={14} className="animate-spin" style={{ color: "var(--accent)" }} />
          <span>
            {report.sync.phase === "collecting"
              ? t("usageStats.syncCollecting")
              : t("usageStats.syncProgress", {
                  done: report.sync.processed,
                  total: report.sync.total,
                })}
          </span>
          {report.sync.total > 0 && (
            <div
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: "var(--bg-subtle)",
                overflow: "hidden",
                minWidth: 80,
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, (report.sync.processed / report.sync.total) * 100)}%`,
                  height: "100%",
                  background: "var(--accent)",
                  transition: "width var(--dur-med) var(--ease-out-warm)",
                }}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 12 }}
        >
          <AlertCircle size={14} style={{ color: "var(--accent)" }} />
          {t("usageStats.error")}
          <span style={{ color: "var(--text-dim)" }}>{error}</span>
        </div>
      )}

      {/* Hero stats */}
      <div
        style={{
          ...cardStyle,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 4,
          padding: "14px 4px",
        }}
      >
        {statCards.map((card, index) => (
          <div
            key={card.key}
            style={{
              padding: "4px 16px",
              borderLeft: index === 0 ? "none" : "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-serif, serif)" }}>
              {loading && !overview ? "—" : card.value}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{card.label}</div>
            {card.hint && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{card.hint}</div>}
          </div>
        ))}
      </div>

      {/* Token activity heatmap */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("usageStats.activityTitle")}</div>
          {segmented(
            HEATMAP_MODES.map((mode) => ({
              key: mode,
              label:
                mode === "daily"
                  ? t("usageStats.modeDaily")
                  : mode === "weekly"
                    ? t("usageStats.modeWeekly")
                    : t("usageStats.modeCumulative"),
              active: heatmapMode === mode,
              onClick: () => setHeatmapMode(mode),
            })),
          )}
        </div>

        <div style={{ marginTop: 14, overflowX: "auto", paddingBottom: 4 }}>
          <div style={{ display: "inline-block", minWidth: "100%" }}>
            <div style={{ position: "relative", height: 16, marginBottom: 4 }}>
              {heatmap.monthLabels.map((label) => (
                <span
                  key={`${label.label}-${label.weekIndex}`}
                  style={{
                    position: "absolute",
                    left: label.weekIndex * 15,
                    fontSize: 10,
                    color: "var(--text-dim)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label.label}
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 3 }}>
              {heatmap.weeks.map((week, weekIndex) => (
                <div key={weekIndex} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {week.cells.map((cell) => (
                    <div
                      key={cell.day}
                      title={`${cell.day} · ${tokens(cell.value)}`}
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 2,
                        background: cell.inWindow ? HEATMAP_LEVEL_COLORS[cell.level] : "transparent",
                        border: cell.inWindow ? "none" : "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {pending
              ? " "
              : t("usageStats.windowTotal", { tokens: tokens(heatmap.totalTokens) })}
            {subagentTokens > 0 &&
              ` · ${t("usageStats.subagentShare", {
                percent: overview && overview.totalTokens > 0
                  ? ((subagentTokens / overview.totalTokens) * 100).toFixed(1)
                  : "0.0",
              })}`}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-dim)" }}>
            <span>{t("usageStats.less")}</span>
            {HEATMAP_LEVEL_COLORS.map((color, index) => (
              <span key={index} style={{ width: 10, height: 10, borderRadius: 2, background: color, display: "inline-block" }} />
            ))}
            <span>{t("usageStats.more")}</span>
          </div>
        </div>
      </div>

      {/* Range control: scopes the two cards below */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{t("usageStats.timeRange")}</div>
        {switching && !syncRunning && (
          <span
            role="status"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)", marginLeft: "auto", marginRight: 8 }}
          >
            <Loader2 size={12} className="animate-spin" />
            {t("usageStats.loadingRange")}
          </span>
        )}
        {segmented(
          RANGES.map((key) => ({
            key,
            label:
              key === "7d"
                ? t("usageStats.range7d")
                : key === "30d"
                  ? t("usageStats.range30d")
                  : t("usageStats.rangeAll"),
            active: range === key,
            onClick: () => setRange(key),
          })),
        )}
      </div>

      {/* Daily token trend */}
      <div style={{ ...cardStyle, opacity: switching ? 0.55 : 1, transition: "opacity var(--dur-fast) var(--ease-out-warm)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t("usageStats.trendTitle")}</span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{rangeLabel}</span>
        </div>
        {pending ? (
          <Placeholder />
        ) : trend.total <= 0 ? (
          <div
            style={{
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius-control)",
              padding: "40px 16px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("usageStats.emptyTitle")}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>{t("usageStats.emptyHint")}</div>
          </div>
        ) : (
          <TrendChart points={trend.points} peak={trend.peak} formatValue={(v) => tokens(v)} />
        )}
      </div>

      {/* Model usage */}
      <div style={{ ...cardStyle, opacity: switching ? 0.55 : 1, transition: "opacity var(--dur-fast) var(--ease-out-warm)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t("usageStats.modelsTitle")}</span>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{rangeLabel}</span>
            {!pending && modelRows.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                {t("usageStats.rangeTotal", {
                  tokens: tokens(modelTotals.tokens),
                  cost: formatCost(modelTotals.cost),
                })}
              </span>
            )}
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {segmented(
              (["tokens", "cost", "taskAvg", "taskMedian", "taskCost", "taskCount"] as const).map((key) => ({
                key,
                label: t(SORT_LABEL_KEYS[key]),
                active: modelSort === key,
                onClick: () => setModelSort(key),
              })),
            )}
            {modelRows.length > MODEL_PREVIEW_ROWS && (
              <button
                type="button"
                onClick={() => setShowAllModels((prev) => !prev)}
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--bg-subtle)",
                  color: "var(--text-muted)",
                  borderRadius: "var(--radius-control)",
                  padding: "3px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {showAllModels
                  ? t("usageStats.showLess")
                  : t("usageStats.showAll", { count: modelRows.length })}
              </button>
            )}
          </div>
        </div>
        {pending ? (
          <Placeholder />
        ) : modelRows.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--border)",
              borderRadius: "var(--radius-control)",
              padding: "40px 16px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("usageStats.emptyTitle")}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>{t("usageStats.emptyHint")}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visibleModelRows.map((entry) => (
              <div key={entry.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.label}</span>
                  <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                    <span style={sortedMetricStyle(modelSort === "tokens")}>{tokens(entry.row.tokens)}</span>
                    {" · "}
                    <span style={sortedMetricStyle(modelSort === "cost")}>{formatCost(entry.row.cost)}</span>
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--bg-subtle)", overflow: "hidden" }}>
                  <div style={{ width: `${entry.shareOfMax}%`, height: "100%", background: "var(--accent)" }} />
                </div>
                {entry.row.taskCount > 0 && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <span>{t("usageStats.perTaskAvgLabel")}</span>
                    <span style={sortedMetricStyle(modelSort === "taskAvg")}>
                      {tokens(entry.row.avgTokensPerTask)}
                    </span>
                    <span>
                      ({t("usageStats.perTaskMedianLabel")}{" "}
                      <span style={sortedMetricStyle(modelSort === "taskMedian")}>
                        {tokens(entry.row.medianTokensPerTask)}
                      </span>
                      )
                    </span>
                    <span style={sortedMetricStyle(modelSort === "taskCost")}>
                      {formatCost(entry.row.avgCostPerTask)}
                    </span>
                    <span style={sortedMetricStyle(modelSort === "taskCount")}>
                      {t("usageStats.perTaskCount", { count: entry.row.taskCount })}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {overview && overview.byAgent.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--text-dim)", textAlign: "right" }}>
          {t("usageStats.agentSplit", {
            main: tokens(overview.byAgent.find((row) => row.agent === "main")?.tokens ?? 0),
            sub: tokens(subagentTokens),
          })}
        </div>
      )}

      {profileSplit.length > 1 && (
        <div style={{ fontSize: 11, color: "var(--text-dim)", textAlign: "right" }}>
          {t("usageStats.profileSplit", {
            list: profileSplit
              .map(
                (row) =>
                  `${row.profile || t("usageStats.profileDefault")} ${tokens(row.tokens)}`,
              )
              .join(" · "),
          })}
        </div>
      )}
    </div>
  );
}

/** Loading placeholder sized like a chart card body. */
function Placeholder() {
  return (
    <div
      style={{
        border: "1px dashed var(--border)",
        borderRadius: "var(--radius-control)",
        padding: "40px 16px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-dim)" }} />
    </div>
  );
}

/** Minimal area chart over the selected range; the axis is day-aligned. */
function TrendChart({
  points,
  peak,
  formatValue,
}: {
  points: DailyActivityPoint[];
  peak: number;
  formatValue: (value: number) => string;
}) {
  const width = 640;
  const height = 160;
  const padTop = 12;
  const padBottom = 20;
  const padLeft = 8;
  const padRight = 8;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (index: number) => padLeft + index * step;
  const y = (value: number) => padTop + innerH - (peak > 0 ? (value / peak) * innerH : 0);

  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.tokens).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${padTop + innerH} L${padLeft},${padTop + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" preserveAspectRatio="none">
      <defs>
        <linearGradient id="usageStatsTrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line x1={padLeft} y1={padTop + innerH} x2={padLeft + innerW} y2={padTop + innerH} stroke="var(--border)" strokeWidth="1" />
      <path d={area} fill="url(#usageStatsTrendFill)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((point, index) =>
        index % Math.ceil(points.length / 6) === 0 || index === points.length - 1 ? (
          <text
            key={point.day}
            x={x(index)}
            y={height - 4}
            fontSize="9"
            fill="var(--text-dim)"
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
          >
            {point.day.slice(5)}
          </text>
        ) : null,
      )}
      <title>{`${points[0]?.day} → ${points[points.length - 1]?.day} · peak ${formatValue(peak)}`}</title>
    </svg>
  );
}
