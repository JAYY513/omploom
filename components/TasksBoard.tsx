"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, CheckCheck, ChevronDown, Layers, Loader2, RefreshCw } from "lucide-react";
import { formatRelativeTime, loadUnreadSessionIds, projectLabel, saveUnreadSessionIds } from "./SessionSidebar-helpers";
import { useI18n } from "@/lib/i18n";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  TASKS_CARD_PREVIEW_ROWS,
  filterTaskRows,
  formatElapsed,
  groupLaneRowsByProject,
  groupTasksByProject,
  parseCollapsedColumns,
  projectDotColor,
  serializeCollapsedColumns,
  splitAttentionQueue,
  type TaskColumnId,
  type TaskProjectGroup,
  type TaskRow,
} from "@/lib/tasks";
import { formatCompactTokens, formatDurationParts } from "@/lib/usage-metrics";

function formatCost(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(3)}`;
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PROJECT_STORAGE_KEY = "omp-loom:tasks-expanded-projects";
const COLUMNS_STORAGE_KEY = "omp-loom:tasks-collapsed-columns";

function loadExpandedCards(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PROJECT_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((k): k is string => typeof k === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function loadCollapsedColumns(): Set<TaskColumnId> {
  if (typeof window === "undefined") return new Set();
  try {
    return parseCollapsedColumns(window.localStorage.getItem(COLUMNS_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

const GROUPED_STORAGE_KEY = "omp-loom:tasks-grouped";

function loadGrouped(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GROUPED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

interface TasksResponse {
  tasks: TaskRow[];
  truncated: boolean;
  usageSynced: boolean;
  today: { cost: number; tokens: number } | null;
}

type View = "attention" | "projects";

interface Props {
  onClose: () => void;
  onSelectSession: (session: TaskRow) => void;
}

export function TasksBoard({ onClose, onSelectSession }: Props) {
  const { t, locale } = useI18n();
  const reducedMotion = usePrefersReducedMotion();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [today, setToday] = useState<{ cost: number; tokens: number } | null>(null);
  const [usageSynced, setUsageSynced] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<View>("attention");
  const [expandedCards, setExpandedCards] = useState<Set<string>>(() => loadExpandedCards());
  const [collapsedColumns, setCollapsedColumns] = useState<Set<TaskColumnId>>(loadCollapsedColumns);
  const [grouped, setGrouped] = useState<boolean>(loadGrouped);
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const requestSeqRef = useRef(0);

  const fetchTasks = useCallback(async (signal?: AbortSignal, showSpinner = false) => {
    const seq = ++requestSeqRef.current;
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch("/api/tasks", { signal });
      if (!res.ok) throw new Error(`tasks ${res.status}`);
      const data = (await res.json()) as TasksResponse;
      if (seq !== requestSeqRef.current) return;
      setTasks(data.tasks ?? []);
      setToday(data.today ?? null);
      setUsageSynced(data.usageSynced !== false);
      setUnreadIds(loadUnreadSessionIds());
      setError(null);
      setLoading(false);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      if ((e as Error)?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    } finally {
      if (seq !== requestSeqRef.current) return;
      if (showSpinner) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchTasks(controller.signal);
    return () => controller.abort();
  }, [fetchTasks]);

  // Live refresh: running-set changes and session-list invalidations arrive
  // over the same SSE the sidebar subscribes to. That channel only carries
  // sessions omp-loom spawned; terminal omp runs are invisible to it, so a
  // slow poll keeps disk-detected running state fresh (visibility events
  // still cover everything between tabs).
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void fetchTasks();
      }, 300);
    };
    const source = new EventSource("/api/agent/running/events");
    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { type?: string; refreshSessionList?: boolean };
        if (data.type === "running" || (data.type === "sessions-changed" && data.refreshSessionList)) {
          schedule();
        }
      } catch {
        // ignore malformed frames
      }
    };
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchTasks();
    }, 10_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchTasks();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      source.close();
    };
  }, [fetchTasks]);

  // One clock for relative times and the running cards' live stopwatch:
  // minute cadence normally, 1 Hz only while something is running.
  const totals = useMemo(() => {
    let running = 0;
    let review = 0;
    for (const row of tasks) {
      if (row.running) running += 1;
      else if (unreadIds.has(row.id)) review += 1;
    }
    return { running, review };
  }, [tasks, unreadIds]);
  const hasRunning = totals.running > 0;

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), hasRunning ? 1_000 : 60_000);
    return () => clearInterval(interval);
  }, [hasRunning]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify([...expandedCards]));
    } catch {
      // ignore storage quota / privacy-mode errors
    }
  }, [expandedCards]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, serializeCollapsedColumns(collapsedColumns));
    } catch {
      // ignore storage quota / privacy-mode errors
    }
  }, [collapsedColumns]);

  useEffect(() => {
    try {
      window.localStorage.setItem(GROUPED_STORAGE_KEY, String(grouped));
    } catch {
      // ignore storage quota / privacy-mode errors
    }
  }, [grouped]);

  const durationUnits = useMemo(
    () => ({
      day: t("usageStats.unitDay"),
      hour: t("usageStats.unitHour"),
      minute: t("usageStats.unitMinute"),
      second: t("usageStats.unitSecond"),
    }),
    [t],
  );

  // Opening a session from the board is the acknowledge action: it clears
  // this board's review badge AND the sidebar's unread dot (shared store).
  const handleOpen = useCallback((row: TaskRow) => {
    setUnreadIds((prev) => {
      if (!prev.has(row.id)) return prev;
      const next = new Set(prev);
      next.delete(row.id);
      saveUnreadSessionIds(next);
      return next;
    });
    onSelectSession(row);
  }, [onSelectSession]);

  const handleMarkAllRead = useCallback(() => {
    setUnreadIds((prev) => {
      if (prev.size === 0) return prev;
      saveUnreadSessionIds(new Set());
      return new Set();
    });
  }, []);

  const toggleCard = useCallback((key: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleColumn = useCallback((id: TaskColumnId) => {
    setCollapsedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const labelOf = useCallback((root: string) => projectLabel(root || "—"), []);

  const filteredRows = useMemo(
    () => filterTaskRows(tasks, projectKey, query),
    [tasks, projectKey, query],
  );
  const attention = useMemo(() => splitAttentionQueue(filteredRows, unreadIds), [filteredRows, unreadIds]);
  const projectGroups = useMemo(
    () => groupTasksByProject(filteredRows, labelOf, unreadIds),
    [filteredRows, labelOf, unreadIds],
  );
  // Chips always show the unfiltered project set so a selection can't erase
  // its own affordance.
  const allGroups = useMemo(
    () => groupTasksByProject(tasks, labelOf, unreadIds),
    [tasks, labelOf, unreadIds],
  );
  // Cards with attention pin open implicitly; the stored set only covers the rest.
  const hotKeys = useMemo(
    () => new Set(projectGroups.filter((g) => g.runningCount > 0 || g.reviewCount > 0).map((g) => g.key)),
    [projectGroups],
  );

  const tokens = (value: number | undefined) => formatCompactTokens(value ?? 0, locale);
  const pending = loading && tasks.length === 0;
  const attentionCount = totals.running + totals.review;
  const filtersActive = projectKey !== null || query.trim() !== "";

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
          title={t("tasksBoard.back")}
          aria-label={t("tasksBoard.back")}
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
          {t("tasksBoard.title")}
        </h1>
        <div style={{ flex: 1 }} />
        {attention.review.length > 0 && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            title={t("tasksBoard.markAllReadTitle")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              borderRadius: "var(--radius-control)",
              padding: "6px 12px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <CheckCheck size={13} />
            {t("tasksBoard.markAllRead")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void fetchTasks(undefined, true)}
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
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {t("tasksBoard.refresh")}
        </button>
      </div>

      {/* Summary bar: board-wide counts + today's burn */}
      {!pending && !error && tasks.length > 0 && (
        <div
          role="status"
          aria-label={t("tasksBoard.summaryLabel")}
          style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
        >
          {totals.running > 0 ? (
            <AttentionChip
              text={t("tasksBoard.runningBadge", { count: totals.running })}
              hot
              pulse={!reducedMotion}
            />
          ) : totals.review === 0 ? (
            <AttentionChip text={t("tasksBoard.allClear")} />
          ) : null}
          {totals.review > 0 && (
            <AttentionChip text={t("tasksBoard.cardReview", { count: totals.review })} />
          )}
          {today && (
            <AttentionChip
              text={t("tasksBoard.burnToday", {
                cost: formatCost(today.cost),
                tokens: formatCompactTokens(today.tokens, locale),
              })}
            />
          )}
        </div>
      )}

      {/* View switch: attention lanes (default) vs per-project patrol */}
      {!pending && !error && tasks.length > 0 && (
        <div
          role="tablist"
          aria-label={t("tasksBoard.viewLabel")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            alignSelf: "flex-start",
            gap: 2,
            background: "var(--bg-subtle)",
            borderRadius: "var(--radius-control)",
            padding: 2,
          }}
        >
          {(["attention", "projects"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              style={{
                border: "none",
                background: view === key ? "var(--bg-selected)" : "transparent",
                color: view === key ? "var(--text)" : "var(--text-muted)",
                fontSize: 12,
                fontWeight: view === key ? 600 : 500,
                padding: "4px 12px",
                borderRadius: "var(--radius-control)",
                cursor: "pointer",
                transition: "background var(--dur-fast) var(--ease-out-warm)",
              }}
            >
              {t(`tasksBoard.view${key === "attention" ? "Attention" : "Projects"}`)}
              {key === "attention" && attentionCount > 0 ? ` · ${attentionCount}` : ""}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar: project filter chips + title search */}
      {!pending && !error && tasks.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div
            role="group"
            aria-label={t("tasksBoard.filterLabel")}
            style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}
          >
            <FilterChip
              label={t("tasksBoard.filterAll")}
              selected={projectKey === null}
              onClick={() => setProjectKey(null)}
            />
            {allGroups.map((group) => (
              <FilterChip
                key={group.key}
                label={group.label}
                dotColor={projectDotColor(group.key)}
                selected={projectKey === group.key}
                hot={group.runningCount > 0}
                onClick={() => setProjectKey(projectKey === group.key ? null : group.key)}
              />
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setGrouped((value) => !value)}
            aria-pressed={grouped}
            title={t("tasksBoard.groupByProject")}
            aria-label={t("tasksBoard.groupByProject")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              height: 30,
              padding: "0 10px",
              fontSize: 11.5,
              border: `1px solid ${grouped ? "var(--accent)" : "var(--border)"}`,
              background: grouped ? "var(--bg-selected)" : "var(--bg-panel)",
              color: grouped ? "var(--text)" : "var(--text-muted)",
              borderRadius: "var(--radius-control)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Layers size={12} aria-hidden="true" />
            {t("tasksBoard.groupByProject")}
          </button>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("tasksBoard.searchPlaceholder")}
            aria-label={t("tasksBoard.searchPlaceholder")}
            style={{
              height: 30,
              width: 210,
              maxWidth: "100%",
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              borderRadius: "var(--radius-control)",
              padding: "0 10px",
              fontSize: 12,
              color: "var(--text)",
            }}
          />
        </div>
      )}

      {!usageSynced && !pending && (
        <div
          role="status"
          style={{
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <Loader2 size={14} className="animate-spin" style={{ color: "var(--accent)" }} />
          <span>{t("tasksBoard.usageSyncing")}</span>
        </div>
      )}

      {pending ? (
        <Placeholder />
      ) : error ? (
        <div style={{ padding: "40px 16px", textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
          {t("tasksBoard.error")}
        </div>
      ) : tasks.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-control)",
            padding: "40px 16px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("tasksBoard.emptyTitle")}</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>{t("tasksBoard.emptyHint")}</div>
        </div>
      ) : filteredRows.length === 0 ? (
        <div
          role="status"
          style={{
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-control)",
            padding: "40px 16px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("tasksBoard.noMatches")}</div>
        </div>
      ) : attentionCount === 0 && view === "attention" && !filtersActive ? (
        <div
          role="status"
          style={{
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-control)",
            padding: "40px 16px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t("tasksBoard.allClearTitle")}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{t("tasksBoard.allClearHint")}</div>
        </div>
      ) : view === "attention" ? (
        <>
        <div className="tasks-board-lanes" role="group" aria-label={t("tasksBoard.boardLabel")}>
          <BoardColumn
            id="running"
            label={t("tasksBoard.running")}
            count={attention.running.length}
            pulse={!reducedMotion}
            collapsed={collapsedColumns.has("running")}
            onToggle={toggleColumn}
            emptyText={t("tasksBoard.emptyRunning")}
            t={t}
          >
            <LaneBody
              rows={attention.running}
              variant="running"
              grouped={grouped}
              labelOf={labelOf}
              now={now}
              durationUnits={durationUnits}
              tokens={tokens}
              onOpen={handleOpen}
              reducedMotion={reducedMotion}
              t={t}
            />
          </BoardColumn>
          <BoardColumn
            id="review"
            label={t("tasksBoard.needsReview")}
            count={attention.review.length}
            collapsed={collapsedColumns.has("review")}
            onToggle={toggleColumn}
            emptyText={t("tasksBoard.emptyReview")}
            t={t}
          >
            <LaneBody
              rows={attention.review}
              variant="review"
              grouped={grouped}
              labelOf={labelOf}
              now={now}
              durationUnits={durationUnits}
              tokens={tokens}
              costOf={(row) => (row.usage ? formatCost(row.usage.cost) : null)}
              onOpen={handleOpen}
              t={t}
            />
          </BoardColumn>
          <BoardColumn
            id="read"
            label={t("tasksBoard.recentlyRead")}
            count={attention.read.length}
            collapsed={collapsedColumns.has("read")}
            onToggle={toggleColumn}
            emptyText={t("tasksBoard.emptyRead")}
            t={t}
          >
            <LaneBody
              rows={attention.read}
              variant="read"
              grouped={grouped}
              labelOf={labelOf}
              now={now}
              durationUnits={durationUnits}
              tokens={tokens}
              onOpen={handleOpen}
              t={t}
            />
          </BoardColumn>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("tasksBoard.sidebarHint")}</div>
        </>
      ) : (
        <ProjectsView
          groups={projectGroups}
          unreadIds={unreadIds}
          expandedCards={expandedCards}
          hotKeys={hotKeys}
          now={now}
          durationUnits={durationUnits}
          tokens={tokens}
          onToggle={toggleCard}
          onOpen={handleOpen}
          reducedMotion={reducedMotion}
          t={t}
        />
      )}
      <style>{`
        @keyframes tasks-board-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        .tasks-board-lanes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
        .tasks-board-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        @media (max-width: 920px) { .tasks-board-lanes { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

/**
 * One lane's cards: flat (default) or clustered under per-project sub-headers
 * when the group-by-project toggle is on and the lane spans more than one
 * project. Grouping never reorders: within-group rows and the group order
 * both follow the lane's incoming sort.
 */
function LaneBody({
  rows,
  variant,
  grouped,
  labelOf,
  now,
  durationUnits,
  tokens,
  costOf,
  onOpen,
  reducedMotion = false,
  t,
}: {
  rows: TaskRow[];
  variant: RowVariant;
  grouped: boolean;
  labelOf: (root: string) => string;
  now: number;
  durationUnits: { day: string; hour: string; minute: string; second: string };
  tokens: (value: number | undefined) => string;
  /** Cost text per row (review lane only); null elsewhere. */
  costOf?: (row: TaskRow) => string | null;
  onOpen: (row: TaskRow) => void;
  reducedMotion?: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const renderRow = (row: TaskRow) => (
    <LaneCard
      key={row.id}
      row={row}
      variant={variant}
      now={now}
      durationUnits={durationUnits}
      tokensText={tokens(row.usage?.tokens)}
      costText={costOf ? costOf(row) : null}
      onOpen={() => onOpen(row)}
      t={t}
    />
  );

  if (!grouped) {
    return <>{rows.map(renderRow)}</>;
  }
  const groups = groupLaneRowsByProject(rows, labelOf);
  if (groups.length <= 1) {
    // Single project: headers add nothing over the cards' own project line.
    return <>{rows.map(renderRow)}</>;
  }
  return (
    <>
      {groups.map((group) => (
        <div
          key={group.key}
          data-lane-group={group.label}
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-muted)",
              minWidth: 0,
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: projectDotColor(group.key) }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.label}</span>
            <span style={{ flexShrink: 0, fontWeight: 700, color: "var(--text-dim)" }}>{group.rows.length}</span>
            {variant === "running" && !reducedMotion && (
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: "var(--accent)",
                  animation: "tasks-board-pulse 1.6s ease-in-out infinite",
                }}
              />
            )}
          </div>
          {group.rows.map(renderRow)}
        </div>
      ))}
    </>
  );
}

function BoardColumn({
  id,
  label,
  count,
  pulse = false,
  collapsed,
  onToggle,
  emptyText,
  t,
  children,
}: {
  id: TaskColumnId;
  label: string;
  count: number;
  pulse?: boolean;
  collapsed: boolean;
  onToggle: (id: TaskColumnId) => void;
  emptyText: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={label}
      data-column={id}
      data-collapsed={collapsed ? "true" : undefined}
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        padding: "10px 10px 8px",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={!collapsed}
        title={collapsed ? t("tasksBoard.expandColumn") : t("tasksBoard.collapseColumn")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text)",
        }}
      >
        {pulse && (
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              flexShrink: 0,
              background: "var(--accent)",
              animation: "tasks-board-pulse 1.6s ease-in-out infinite",
            }}
          />
        )}
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: count > 0 ? "var(--text)" : "var(--text-dim)",
            background: count > 0 ? "var(--bg-selected)" : "transparent",
            borderRadius: 999,
            padding: "1px 7px",
            flexShrink: 0,
          }}
        >
          {count}
        </span>
        <span style={{ flex: 1 }} />
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{
            color: "var(--text-dim)",
            flexShrink: 0,
            transform: collapsed ? "rotate(-90deg)" : "none",
            transition: "transform var(--dur-fast) var(--ease-out-warm)",
          }}
        />
      </button>
      {!collapsed && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginTop: 8,
            minHeight: 26,
            maxHeight: "min(58vh, 620px)",
            overflowY: "auto",
          }}
        >
          {count === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "4px 2px" }}>{emptyText}</div>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}

function AttentionChip({ text, hot = false, pulse = false }: { text: string; hot?: boolean; pulse?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10,
        fontWeight: 700,
        color: hot ? "var(--accent)" : "var(--text-muted)",
        border: `1px solid ${hot ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 999,
        padding: "1px 8px",
        flexShrink: 0,
      }}
    >
      {pulse && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--accent)",
            animation: "tasks-board-pulse 1.6s ease-in-out infinite",
          }}
        />
      )}
      {text}
    </span>
  );
}

function FilterChip({
  label,
  dotColor,
  selected,
  hot = false,
  onClick,
}: {
  label: string;
  dotColor?: string;
  selected: boolean;
  hot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        maxWidth: 220,
        padding: "3px 10px",
        fontSize: 11.5,
        fontWeight: selected ? 600 : 500,
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        background: selected ? "var(--bg-selected)" : "var(--bg-panel)",
        color: selected ? "var(--text)" : "var(--text-muted)",
        borderRadius: 999,
        cursor: "pointer",
        transition: "background var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)",
      }}
    >
      {dotColor && (
        <span
          aria-hidden="true"
          style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: dotColor }}
        />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {hot && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            background: "var(--accent)",
            animation: "tasks-board-pulse 1.6s ease-in-out infinite",
          }}
        />
      )}
    </button>
  );
}

/** Thin context-usage bar under a running card's meta. Decorative: the
 * percent also renders as text in the live bits line. */
function CtxBar({ percent }: { percent: number }) {
  const pct = Math.min(100, Math.max(0, percent));
  const tone =
    pct > 90 ? "var(--status-error)" : pct > 70 ? "var(--status-warning)" : "var(--accent)";
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        height: 4,
        marginTop: 6,
        borderRadius: 2,
        background: "var(--border)",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          display: "block",
          height: "100%",
          width: `${pct}%`,
          background: tone,
          borderRadius: 2,
          transition: "width var(--dur-med) var(--ease-out-warm)",
        }}
      />
    </span>
  );
}

type RowVariant = "running" | "review" | "read";

function modelLabelOf(row: TaskRow): string | null {
  return (
    row.live?.modelId ||
    (row.usage?.model ? `${row.usage.provider ? `${row.usage.provider}/` : ""}${row.usage.model}` : null)
  );
}

function titleOf(row: TaskRow): string {
  return row.name?.trim() ? row.name : row.firstMessage || row.id;
}

function liveBitsOf(row: TaskRow, variant: RowVariant, now: number, t: (key: string, params?: Record<string, string | number>) => string): string[] {
  const bits: string[] = [];
  if (variant !== "running" || !row.live) return bits;
  if (row.live.isCompacting) bits.push(t("tasksBoard.compacting"));
  if (row.live.queuedMessageCount > 0) bits.push(t("tasksBoard.queued", { count: row.live.queuedMessageCount }));
  if (row.live.contextPercent !== null) bits.push(t("tasksBoard.context", { percent: Math.round(row.live.contextPercent) }));
  if (row.live.tokensPerSecond !== null && row.live.tokensPerSecond > 0) bits.push(t("tasksBoard.speed", { value: Math.round(row.live.tokensPerSecond) }));
  if (row.live.todoTotal > 0) bits.push(t("tasksBoard.todo", { done: row.live.todoDone, total: row.live.todoTotal }));
  const startedMs = Date.parse(row.created);
  if (Number.isFinite(startedMs)) bits.push(t("tasksBoard.elapsed", { elapsed: formatElapsed(now - startedMs) }));
  return bits;
}

/**
 * Column card: vertical, compact, two-line-clamped title. Running cards add
 * the live stopwatch and the context gauge; review cards carry the full
 * worth-opening meta (model · time · tokens · cost); read is dimmed and
 * cost-free.
 */
function LaneCard({
  row,
  variant,
  now,
  durationUnits,
  tokensText,
  costText,
  onOpen,
  t,
}: {
  row: TaskRow;
  variant: RowVariant;
  now: number;
  durationUnits: { day: string; hour: string; minute: string; second: string };
  tokensText: string;
  costText: string | null;
  onOpen: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const relative = formatRelativeTime(row.modified, "", now);
  const duration =
    row.usage && row.usage.activeMs > 0
      ? formatDurationParts(row.usage.activeMs, durationUnits).join(" ")
      : null;
  const projectRoot = row.projectRoot ?? row.cwd ?? "";
  const liveBits = liveBitsOf(row, variant, now, t);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        ...(variant === "running" ? { borderLeft: "3px solid var(--accent)" } : {}),
        borderRadius: "var(--radius-control)",
        padding: "8px 10px",
        cursor: "pointer",
        color: "var(--text)",
        ...(variant === "read" ? { opacity: 0.72 } : {}),
      }}
    >
      <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          className="tasks-board-clamp-2"
          style={{ fontSize: 12.5, fontWeight: variant === "read" ? 500 : 600, lineHeight: 1.35, flex: 1, minWidth: 0 }}
        >
          {titleOf(row)}
        </span>
        <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-dim)" }}>{relative ?? ""}</span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, color: "var(--text-muted)", minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            flexShrink: 0,
            background: projectDotColor(projectRoot.toLowerCase() || row.cwd || ""),
          }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {projectLabel(projectRoot || row.cwd || "—")}
          {row.worktreeBranch ? ` · ${row.worktreeBranch}` : ""}
        </span>
      </span>
      <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {[modelLabelOf(row), duration, tokensText, costText].filter(Boolean).join(" · ")}
      </span>
      {variant === "running" && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            marginTop: 5,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            color: "var(--accent)",
          }}
        >
          <Activity size={12} aria-hidden="true" />
          <span title={t("tasksBoard.elapsed", { elapsed: formatElapsed(Math.max(0, now - Date.parse(row.created) || 0)) })}>
            {formatElapsed(Math.max(0, now - (Date.parse(row.created) || now)))}
          </span>
        </span>
      )}
      {variant === "running" && row.live?.contextPercent != null && <CtxBar percent={row.live.contextPercent} />}
      {liveBits.length > 0 && (
        <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "var(--text-dim)" }}>
          {liveBits.join(" · ")}
        </span>
      )}
    </button>
  );
}

function ProjectsView({
  groups,
  unreadIds,
  expandedCards,
  hotKeys,
  now,
  durationUnits,
  tokens,
  onToggle,
  onOpen,
  reducedMotion,
  t,
}: {
  groups: TaskProjectGroup[];
  unreadIds: ReadonlySet<string>;
  expandedCards: ReadonlySet<string>;
  hotKeys: ReadonlySet<string>;
  now: number;
  durationUnits: { day: string; hour: string; minute: string; second: string };
  tokens: (value: number | undefined) => string;
  onToggle: (key: string) => void;
  onOpen: (row: TaskRow) => void;
  reducedMotion: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <>
      {groups.map((group) => {
        const open = hotKeys.has(group.key) || expandedCards.has(group.key);
        const visible = open ? group.rows : group.rows.slice(0, TASKS_CARD_PREVIEW_ROWS);
        const hidden = group.rows.length - visible.length;
        return (
          <section
            key={group.key}
            aria-label={group.label}
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-card)",
              padding: "10px 12px",
            }}
          >
            <button
              type="button"
              onClick={() => onToggle(group.key)}
              aria-expanded={open}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--text)",
                textAlign: "left",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: projectDotColor(group.key),
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {group.label}
                {group.branch ? ` · ${group.branch}` : ""}
              </span>
              {group.runningCount > 0 && (
                <AttentionChip
                  text={t("tasksBoard.cardRunning", { count: group.runningCount })}
                  hot
                  pulse={!reducedMotion}
                />
              )}
              {group.reviewCount > 0 && (
                <AttentionChip text={t("tasksBoard.cardReview", { count: group.reviewCount })} />
              )}
              <span style={{ flex: 1 }} />
              <ChevronDown
                size={14}
                aria-hidden="true"
                style={{
                  color: "var(--text-dim)",
                  flexShrink: 0,
                  transform: open ? "rotate(180deg)" : "none",
                  transition: "transform var(--dur-fast) var(--ease-out-warm)",
                }}
              />
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {visible.map((row) => (
                <TaskRowCard
                  key={row.id}
                  row={row}
                  variant={row.running ? "running" : unreadIds.has(row.id) ? "review" : "read"}
                  flat
                  now={now}
                  durationUnits={durationUnits}
                  tokensText={tokens(row.usage?.tokens)}
                  costText={!row.running && unreadIds.has(row.id) && row.usage ? formatCost(row.usage.cost) : null}
                  onOpen={() => onOpen(row)}
                  t={t}
                />
              ))}
            </div>
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => onToggle(group.key)}
                style={{
                  marginTop: 8,
                  border: "none",
                  background: "none",
                  padding: 0,
                  fontSize: 11,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                {t("tasksBoard.showMore", { count: hidden })}
              </button>
            )}
          </section>
        );
      })}
    </>
  );
}

/**
 * Wide row card for the by-project view. Three visual tiers so the queue
 * scans without reading: running gets the accent rail + live line
 * (stopwatch + context gauge), review carries the full worth-opening meta
 * (model · time · tokens · cost), read is dimmed and cost-free. Every row
 * carries its project chip: color dot (deterministic per project root) +
 * name + branch.
 */
function TaskRowCard({
  row,
  variant,
  flat = false,
  now,
  durationUnits,
  tokensText,
  costText,
  onOpen,
  t,
}: {
  row: TaskRow;
  variant: RowVariant;
  flat?: boolean;
  now: number;
  durationUnits: { day: string; hour: string; minute: string; second: string };
  tokensText: string;
  costText: string | null;
  onOpen: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const relative = formatRelativeTime(row.modified, "", now);
  const title = titleOf(row);
  const duration = row.usage && row.usage.activeMs > 0
    ? formatDurationParts(row.usage.activeMs, durationUnits).join(" ")
    : null;
  const projectRoot = row.projectRoot ?? row.cwd ?? "";
  const liveBits = liveBitsOf(row, variant, now, t);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        background: flat ? "var(--bg)" : "var(--bg-panel)",
        border: "1px solid var(--border)",
        ...(variant === "running" ? { borderLeft: "3px solid var(--accent)" } : {}),
        borderRadius: "var(--radius-card)",
        ...(!flat ? { boxShadow: "var(--shadow-card)" } : {}),
        padding: "10px 12px",
        cursor: "pointer",
        color: "var(--text)",
        ...(variant === "read" ? { opacity: 0.72 } : {}),
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: variant === "read" ? 500 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </span>
          {variant === "running" ? (
            <AttentionChip text={t("tasksBoard.running")} hot pulse />
          ) : variant === "review" ? (
            <AttentionChip text={t("tasksBoard.newDone")} />
          ) : null}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, color: "var(--text-muted)", minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              flexShrink: 0,
              background: projectDotColor(projectRoot.toLowerCase() || row.cwd || ""),
            }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {projectLabel(projectRoot || row.cwd || "—")}
            {row.worktreeBranch ? ` · ${row.worktreeBranch}` : ""}
          </span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, fontSize: 11, color: "var(--text-muted)", minWidth: 0 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[modelLabelOf(row), duration, tokensText, costText].filter(Boolean).join(" · ")}
          </span>
        </span>
        {liveBits.length > 0 && (
          <span style={{ display: "block", marginTop: 3, fontSize: 11, color: "var(--text-dim)" }}>
            {liveBits.join(" · ")}
          </span>
        )}
        {variant === "running" && row.live?.contextPercent != null && <CtxBar percent={row.live.contextPercent} />}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, fontSize: 11, color: "var(--text-dim)" }}>
        {variant === "running" && <Activity size={13} style={{ color: "var(--accent)" }} aria-hidden="true" />}
        {relative ?? ""}
      </span>
    </button>
  );
}

function Placeholder() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            height: 56,
            borderRadius: "var(--radius-card)",
            border: "1px solid var(--border)",
            background: "var(--bg-panel)",
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  );
}
