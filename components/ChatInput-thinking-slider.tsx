"use client";

import { useRef, useState, useCallback, type CSSProperties, type KeyboardEvent } from "react";
import { CircleQuestionMark } from "lucide-react";
import { thinkingLevelIndex } from "@/lib/thinking-levels";
import { useI18n } from "@/lib/i18n";

interface Props {
  /** Ordered raw level values (includes sentinels like auto/off). */
  levels: string[];
  /** Currently selected raw level. */
  value: string;
  /** Mapped display label for a raw level (wire-value overrides). */
  displayLabelFor: (level: string) => string;
  /** True when the selection sits on the strongest stop (PromptBar `data-max`). */
  maxed: boolean;
  disabled?: boolean;
  onChange: (level: string) => void;
  onEscape?: () => void;
  onShowAll?: () => void;
}

const TRACK_EDGE_PX = 11;

/** PromptBar stop math: edge-padded, clamped, rounded to the nearest stop. */
function indexFromClientX(clientX: number, rect: { left: number; width: number }, count: number): number {
  const span = Math.max(1, rect.width - TRACK_EDGE_PX * 2);
  const k = (clientX - rect.left - TRACK_EDGE_PX) / span;
  return Math.max(0, Math.min(count - 1, Math.round(k * (count - 1))));
}

function stopAt(index: number, count: number): string {
  if (count <= 1) return "50%";
  return `calc(${TRACK_EDGE_PX}px + (100% - ${TRACK_EDGE_PX * 2}px) * ${index / (count - 1)})`;
}

/** PromptBar fill math: full-bleed on the last stop, else 7px (half a thumb) past the stop. */
function fillAt(index: number, count: number): string {
  if (count <= 1) return "0px";
  if (index >= count - 1) return "100%";
  return `calc(${stopAt(index, count)} + 7px)`;
}

/**
 * PromptBar effort view for the reasoning menu: head row with the live
 * level, Faster/Smarter ends, a full-width pill track with a sliding
 * 14×28 thumb, arrows/Home/End keys. Dragging previews on the thumb and
 * commits once on release — a sweep across seven stops fires one
 * `onChange`, not one RPC per stop. The traditional card list hides
 * behind "Show all…" and stays the click path.
 */
export function ThinkingEffortSlider({
  levels, value, displayLabelFor, maxed, disabled, onChange, onEscape, onShowAll,
}: Props) {
  const { t } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const count = levels.length;
  const activeIndex = thinkingLevelIndex(levels, value);
  const shownIndex = dragIndex ?? activeIndex;
  const shownLevel = levels[shownIndex] ?? value;

  const commit = useCallback((index: number) => {
    const level = levels[index];
    if (level !== undefined && level !== value) onChange(level);
  }, [levels, value, onChange]);

  const indexFromEvent = (clientX: number): number | null => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return indexFromClientX(clientX, rect, count);
  };

  const endDrag = (clientX: number) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const index = indexFromEvent(clientX);
    if (index !== null) commit(index);
    setDragIndex(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step =
      e.key === "ArrowRight" || e.key === "ArrowUp" ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (step !== 0) {
      e.preventDefault();
      commit(Math.max(0, Math.min(count - 1, activeIndex + step)));
    } else if (e.key === "Home") {
      e.preventDefault();
      commit(0);
    } else if (e.key === "End") {
      e.preventDefault();
      commit(count - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onEscape?.();
    }
  };

  const hint = t("chatInput.reasoningEffortHint");

  return (
    <div className="picker-effort" data-max={maxed ? "true" : undefined}>
      <div className="picker-effort-head">
        <span className="picker-effort-title">{t("chatInput.reasoningLabel")}</span>
        <span className="picker-effort-level">{displayLabelFor(shownLevel)}</span>
        <span className="picker-effort-help" title={hint} role="img" aria-label={hint}>
          <CircleQuestionMark size={14} strokeWidth={1.8} aria-hidden="true" />
        </span>
      </div>
      <div className="picker-effort-ends" aria-hidden="true">
        <span>{t("chatInput.reasoningFaster")}</span>
        <span>{t("chatInput.reasoningSmarter")}</span>
      </div>
      <div
        ref={trackRef}
        className="picker-effort-track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={t("chatInput.changeReasoning")}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, count - 1)}
        aria-valuenow={shownIndex}
        aria-valuetext={displayLabelFor(shownLevel)}
        aria-disabled={disabled}
        data-disabled={disabled ? "true" : undefined}
        style={{ "--pb-effort-x": stopAt(shownIndex, count), "--pb-effort-fill": fillAt(shownIndex, count) } as CSSProperties}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          draggingRef.current = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // jsdom / no pointer capture: moves still arrive on the track.
          }
          e.currentTarget.focus({ preventScroll: true });
          const index = indexFromEvent(e.clientX);
          if (index !== null) setDragIndex(index);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current || disabled) return;
          const index = indexFromEvent(e.clientX);
          if (index !== null) setDragIndex(index);
        }}
        onPointerUp={(e) => endDrag(e.clientX)}
        onPointerCancel={() => {
          draggingRef.current = false;
          setDragIndex(null);
        }}
        onKeyDown={onKeyDown}
      >
        <span className="picker-effort-fill" aria-hidden="true" />
        {levels.map((level, i) => (
          <i
            key={level}
            className="picker-effort-dot"
            aria-hidden="true"
            title={displayLabelFor(level)}
            style={{ left: stopAt(i, count) }}
          />
        ))}
        <span className="picker-effort-thumb" aria-hidden="true" />
      </div>
      {onShowAll && (
        <button type="button" className="picker-effort-more" onClick={onShowAll}>
          {t("chatInput.reasoningShowAll")}
        </button>
      )}
    </div>
  );
}
