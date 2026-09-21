// Adapted from StatusMark (react-bits by DavidHDev, MIT License).
// The original drives ring morph/spin with motion/react; this port renders the
// same SVG states (pending ring, indeterminate spin, determinate progress arc,
// check / cross / cancelled-bar glyphs) with CSS transitions + animations.
// Palette swap: hardcoded #22c55e/#ef4444 become --status-success/--status-error
// tokens; running uses --accent, idle states use --text-dim.
"use client";

import type { CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export type StatusMarkStatus = "pending" | "running" | "done" | "failed" | "cancelled";

interface StatusMarkProps {
  status?: StatusMarkStatus;
  /** 0..1 determinate progress while running; omitted = indeterminate spin. */
  progress?: number;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  label?: string;
}

const CHECK = "M7.5 12.25 10.5 15.25 16.75 8.75";
const CROSS = "M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5";
const BAR = "M8 12H16";

const SPOKEN: Record<StatusMarkStatus, string> = {
  pending: "Pending",
  running: "In progress",
  done: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function StatusMark({
  status = "pending",
  progress,
  size = 14,
  strokeWidth = 2,
  style,
  label,
}: StatusMarkProps) {
  const reduced = usePrefersReducedMotion();
  const determinate =
    status === "running" && typeof progress === "number" && Number.isFinite(progress);
  const indeterminate = status === "running" && !determinate;
  const fraction = determinate ? Math.min(1, Math.max(0, progress as number)) : 1;

  const radius = 10 - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  // Static (reduced-motion / SSR) and animated states share geometry.
  const arcLength = indeterminate ? circumference * 0.68 : circumference * fraction;

  const color =
    status === "running"
      ? "var(--accent)"
      : status === "done"
        ? "var(--status-success)"
        : status === "failed"
          ? "var(--status-error)"
          : "var(--text-dim)";

  const spoken = `${SPOKEN[status]}${determinate ? `, ${Math.round(fraction * 100)}%` : ""}${label ? `: ${label}` : ""}`;

  return (
    <span
      data-effects="status-mark"
      data-status={status}
      role={label ? "img" : undefined}
      aria-label={label ? spoken : undefined}
      aria-hidden={label ? undefined : true}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flexShrink: 0,
        color,
        ...style,
      }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          opacity={status === "pending" || status === "cancelled" ? 0.55 : 0.22}
        />
        {(indeterminate || determinate) && (
          <g
            className={indeterminate && !reduced ? "effects-status-spin" : undefined}
            style={{ transformOrigin: "12px 12px" }}
          >
            <circle
              cx="12"
              cy="12"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${arcLength} ${circumference}`}
              transform="rotate(-90 12 12)"
            />
          </g>
        )}
        {status === "done" && (
          <path
            d={CHECK}
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={reduced ? undefined : "effects-status-draw"}
          />
        )}
        {status === "failed" && (
          <path
            d={CROSS}
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            className={reduced ? undefined : "effects-status-draw"}
          />
        )}
        {status === "cancelled" && (
          <path
            d={BAR}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        )}
      </svg>
    </span>
  );
}
