// Adapted from CallChip (react-bits by DavidHDev, MIT License).
// The original wipes a fill across an inline tool-call chip, ticks a live ms
// counter and settles with a green wash (or a red stop + retry glyph) using
// Hugeicons; this port keeps the same contract with CSS + a token palette and
// the lucide retry glyph. Trimmed from upstream: the icon slot and the shake
// tuning knobs.
"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { RotateCw } from "lucide-react";

export type CallChipStatus = "running" | "success" | "error";

export interface CallChipProps {
  /** Tool name shown on the chip. */
  name: ReactNode;
  status?: CallChipStatus;
  /** Epoch ms the call started; omitted = the chip starts counting at mount. */
  startedAt?: number;
  /** 0..1 wipe for a determinate call; omitted = the wipe runs indeterminate. */
  progress?: number;
  size?: "sm" | "md";
  /** Accessible label; the chip becomes a live region only when it is set. */
  label?: string;
  onRetry?: () => void;
  className?: string;
  style?: CSSProperties;
}

/** Tick cadence for the live counter; the chip renders tenths of a second. */
export const CALL_CHIP_TICK_MS = 100;

/** Sub-second calls read in ms, everything else in s / m s. */
export function formatCallChipElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function CallChip({
  name,
  status = "running",
  startedAt,
  progress,
  size = "sm",
  label,
  onRetry,
  className,
  style,
}: CallChipProps) {
  const [now, setNow] = useState(0);
  const startRef = useRef(startedAt ?? 0);

  // Never read the clock during render: the first paint would differ between
  // the server and the client for no benefit (the chip appears while running).
  useEffect(() => {
    startRef.current = startedAt ?? Date.now();
    setNow(Date.now());
  }, [startedAt]);

  useEffect(() => {
    if (status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), CALL_CHIP_TICK_MS);
    return () => window.clearInterval(timer);
  }, [status]);

  const elapsed = now > 0 && startRef.current > 0 ? Math.max(0, now - startRef.current) : 0;
  const determinate = typeof progress === "number" && Number.isFinite(progress) && progress >= 0;
  const fraction = determinate ? Math.min(1, progress as number) : 1;

  return (
    <span
      data-effects="call-chip"
      data-status={status}
      data-size={size}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      style={style}
    >
      <span
        className="call-chip__fill"
        aria-hidden
        style={determinate ? { transform: `scaleX(${fraction})` } : undefined}
      />
      <span className="call-chip__name">{name}</span>
      <span className="call-chip__time">{formatCallChipElapsed(elapsed)}</span>
      {status === "error" && onRetry ? (
        <button type="button" className="call-chip__retry" onClick={onRetry} aria-label="Retry">
          <RotateCw size={11} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
