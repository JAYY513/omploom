"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, CircleAlert, Columns3, List, ListChecks } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { TodoItem, TodoPhase } from "@/lib/pi-types";
import { StatusMark, type StatusMarkStatus } from "./effects/StatusMark";
import { SpringCheck } from "./effects/SpringCheck";

type TodoView = "list" | "board";

const TODO_VIEW_STORAGE_KEY = "omp-loom:todo-view";

function loadTodoView(): TodoView {
  if (typeof window === "undefined") return "list";
  try {
    return window.localStorage.getItem(TODO_VIEW_STORAGE_KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

function todoStatusMarkStatus(status: TodoItem["status"]): StatusMarkStatus {
  if (status === "completed") return "done";
  if (status === "in_progress") return "running";
  if (status === "abandoned") return "cancelled";
  return "pending";
}

function TodoStatusIcon({ status }: { status: TodoItem["status"] }) {
  if (status === "completed") {
    return <SpringCheck size={15} />;
  }
  if (status === "blocked") {
    // Blocked must not read as a plain pending ring: the StatusMark port
    // collapsed "blocked" into the pending branch and the semantics were
    // lost. The alert glyph in the warning tone carries "waiting on a
    // blocker" again; the row's aria-label keeps the spoken status.
    return (
      <CircleAlert size={14} strokeWidth={1.8} aria-hidden style={{ color: "var(--status-warning)" }} />
    );
  }
  return (
    <StatusMark
      status={todoStatusMarkStatus(status)}
      size={14}
    />
  );
}

interface TodoListProps {
  phases?: TodoPhase[];
  /** Render as a composer-attached panel: the header row becomes a
   * collapse/expand toggle and the section margin is dropped. */
  collapsible?: boolean;
  /** Initial expansion when `collapsible` (default: collapsed). */
  defaultExpanded?: boolean;
  /** Initial layout view; defaults to the persisted choice (list). */
  defaultView?: TodoView;
  /** Controlled collapse state (ComposerPanels persists it in localStorage).
   * When omitted the component keeps its own uncontrolled state. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

/** Collapsed-preview window order: live work first (in_progress, then
 * blocked), then completed, so a long first phase can't hide the live work
 * behind "Show all". */
function previewTaskOrder(status: TodoItem["status"]): number {
  if (status === "in_progress") return 0;
  if (status === "blocked") return 1;
  if (status === "completed") return 2;
  return 3;
}

function phaseProgress(phase: TodoPhase): { done: number; total: number } {
  const tasks = phase.tasks ?? [];
  return { done: tasks.filter((task) => task.status === "completed").length, total: tasks.length };
}

function clampStyle(lines: number) {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical" as const,
    overflow: "hidden",
  };
}

function ViewToggle({ active, icon, label, onClick }: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={label}
      aria-label={label}
      onClick={(e) => {
        // The collapse header is a sibling button, not a parent — but the
        // row-level click handlers must still not see layout switches.
        e.stopPropagation();
        onClick();
      }}
      className="flex cursor-pointer items-center justify-center"
      style={{
        width: 22,
        height: 22,
        borderRadius: "var(--radius-control)",
        border: "1px solid transparent",
        background: active ? "var(--bg-selected)" : "transparent",
        color: active ? "var(--text)" : "var(--text-dim)",
        transition: "background var(--dur-fast) var(--ease-out-warm), color var(--dur-fast) var(--ease-out-warm)",
      }}
    >
      {icon}
    </button>
  );
}

export function TodoList({ phases = [], collapsible = false, defaultExpanded = false, defaultView, collapsed: collapsedProp, onCollapsedChange }: TodoListProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [collapsedState, setCollapsedState] = useState(collapsible ? !defaultExpanded : false);
  const [view, setView] = useState<TodoView>(() => defaultView ?? loadTodoView());
  const collapsed = collapsedProp ?? collapsedState;
  const setCollapsed = (value: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(collapsed) : value;
    onCollapsedChange?.(next);
    setCollapsedState(next);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(TODO_VIEW_STORAGE_KEY, view);
    } catch {
      // storage optional; the in-memory view still applies
    }
  }, [view]);

  if (phases.length === 0) return null;

  const tasks = phases.flatMap((phase) => phase.tasks);
  const done = tasks.filter((task) => task.status === "completed").length;
  let remainingPreviewTasks = 5;
  const displayedPhases = (expanded ? phases : phases.slice(0, 4)).map((phase) => {
    if (expanded) return phase;
    // Surface the live work: in_progress first, then blocked/completed, within
    // the same 5-task preview budget.
    const orderedTasks = [...phase.tasks].sort((a, b) => previewTaskOrder(a.status) - previewTaskOrder(b.status));
    const displayedTasks = orderedTasks.slice(0, Math.max(0, remainingPreviewTasks));
    remainingPreviewTasks -= displayedTasks.length;
    return { ...phase, tasks: displayedTasks };
  }).filter((phase) => phase.tasks.length > 0);
  const isTruncated = displayedPhases.reduce((count, phase) => count + phase.tasks.length, 0) < tasks.length;

  const headerRowClass = "flex items-center gap-2 px-3 py-2 text-xs text-text-muted";
  const headerBorderClass = collapsed ? "" : "border-b border-border";
  const progress = t("chatWindow.todoProgress", { done, total: tasks.length });

  const titleRow = (
    <>
      <ListChecks size={15} strokeWidth={1.8} aria-hidden />
      <strong className="font-medium text-text">{t("chatWindow.todoList")}</strong>
      <span className="ml-auto">{progress}</span>
    </>
  );

  return (
    <section
      aria-label={t("chatWindow.todoList")}
      className={`overflow-hidden border border-border bg-bg-subtle ${collapsible ? "" : "my-2"}`}
      style={{ borderRadius: "var(--radius-card)" }}
    >
      <div className={`${headerRowClass} ${headerBorderClass}`}>
        {collapsible ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? t("chatWindow.expandPanel") : t("chatWindow.collapsePanel")}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
            style={{ background: "none" }}
          >
            {titleRow}
            <ChevronDown
              size={14}
              strokeWidth={1.8}
              aria-hidden
              style={{
                color: "var(--text-dim)",
                transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                transition: "transform var(--dur-med) var(--ease-out-warm)",
              }}
            />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">{titleRow}</div>
        )}
        <span
          role="group"
          aria-label={t("chatWindow.todoViewLabel")}
          className="flex shrink-0 items-center gap-0.5"
        >
          <ViewToggle
            active={view === "list"}
            icon={<List size={13} strokeWidth={1.8} aria-hidden />}
            label={t("chatWindow.todoViewList")}
            onClick={() => setView("list")}
          />
          <ViewToggle
            active={view === "board"}
            icon={<Columns3 size={13} strokeWidth={1.8} aria-hidden />}
            label={t("chatWindow.todoViewBoard")}
            onClick={() => setView("board")}
          />
        </span>
      </div>
      {!collapsed && (
        <>
      {/* Capped and scrolled like the sibling subagents panel in
          ComposerPanels. Both panels are pinned above the composer, outside the
          chat scroller, so an uncapped list runs its own rows off-screen with
          nothing able to reach them — a 56-task plan was unreadable past the
          first screenful. The Show all/less footer sits outside this element so
          it stays put instead of scrolling away with the list.
          Unlike the subagents panel, whose cards are buttons and therefore
          reachable by Tab, todo rows are static text: without an explicit
          tabIndex a keyboard-only reader could not scroll this at all. Its name
          differs from the section's so a screen reader does not announce
          "Tasks" twice on the way in. */}
      {view === "list" ? (
        <div
          className="grid gap-3 px-3 py-2.5 animate-slide-down"
          style={{ maxHeight: "min(30vh, 240px)", overflowY: "auto" }}
          role="group"
          aria-label={t("chatWindow.todoPlanScroll")}
          tabIndex={0}
        >
          {displayedPhases.map((phase, phaseIndex) => (
            <div key={phase.id ?? `${phase.name}-${phaseIndex}`} className="grid gap-1.5">
              <div className="text-[11px] font-medium text-text-muted">{phase.name}</div>
              <div className="grid gap-1.5">
                {phase.tasks.map((task, taskIndex) => (
                  <div
                    key={task.id ?? `${task.content}-${taskIndex}`}
                    className="flex min-w-0 items-start gap-2 text-[13px] text-text"
                    aria-label={`${t(`chatWindow.todoStatus.${task.status}`)}: ${task.content}`}
                  >
                    <span className="mt-0.5 shrink-0" aria-hidden><TodoStatusIcon status={task.status} /></span>
                    <span className="min-w-0">
                      <span className={task.status === "completed" || task.status === "abandoned" ? "text-text-dim line-through" : undefined}>
                        {task.content}
                      </span>
                      {task.blocker && (
                        <span className="mt-0.5 block text-[11px] text-text-muted">
                          {t("chatWindow.todoBlocker", { blocker: task.blocker })}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Board view: compact phase swimlanes laid out side by side. One
           shared scroller owns both axes so long plans stay reachable by
           keyboard; lanes align to the top like a kanban. */
        <div
          className="flex gap-2 px-3 py-2.5 animate-slide-down"
          style={{ maxHeight: "min(30vh, 240px)", overflowY: "auto", overflowX: "auto", alignItems: "flex-start" }}
          role="group"
          aria-label={t("chatWindow.todoPlanScroll")}
          tabIndex={0}
        >
          {displayedPhases.map((phase, phaseIndex) => {
            const laneProgress = phaseProgress(phase);
            return (
              <div
                key={phase.id ?? `${phase.name}-${phaseIndex}`}
                data-todo-lane={phase.name}
                style={{
                  flex: "1 0 176px",
                  maxWidth: 260,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)",
                  padding: "7px 8px",
                  minHeight: 40,
                }}
              >
                <div className="flex items-baseline gap-2 text-[11px] font-medium text-text-muted">
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{phase.name}</span>
                  <span className="ml-auto shrink-0" style={{ color: "var(--text-dim)" }}>
                    {laneProgress.done}/{laneProgress.total}
                  </span>
                </div>
                <div className="grid gap-1">
                  {phase.tasks.map((task, taskIndex) => (
                    <div
                      key={task.id ?? `${task.content}-${taskIndex}`}
                      className="flex min-w-0 items-start gap-1.5 text-[12px] text-text"
                      aria-label={`${t(`chatWindow.todoStatus.${task.status}`)}: ${task.content}`}
                    >
                      <span className="mt-[1px] shrink-0" aria-hidden><TodoStatusIcon status={task.status} /></span>
                      <span className="min-w-0">
                        <span
                          style={clampStyle(2)}
                          className={task.status === "completed" || task.status === "abandoned" ? "text-text-dim line-through" : undefined}
                        >
                          {task.content}
                        </span>
                        {task.blocker && (
                          <span className="mt-0.5 block text-[10.5px] text-text-muted">
                            {t("chatWindow.todoBlocker", { blocker: task.blocker })}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {(isTruncated || expanded) && (
        <button
          type="button"
          className="border-t border-border px-3 py-2 text-left text-xs text-accent hover:text-accent-hover"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("chatWindow.todoShowLess") : t("chatWindow.todoShowAll")}
        </button>
      )}
        </>
      )}
    </section>
  );
}
