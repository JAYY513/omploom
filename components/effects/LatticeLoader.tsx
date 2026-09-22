// Adapted from LatticeLoader (react-bits by DavidHDev, MIT License).
// A 3x3 lattice whose cells brighten in a phase-offset wave — the `orbit`
// pattern: a hole in the centre, the wave travelling around the ring — beside a
// label and a live stopwatch, resolving into a check or a cross. Upstream also
// ships a pattern table, a 4x4 grid and glow/shape options; this port keeps the
// single pattern the composer status row uses.
//
// The grid and the stopwatch are decorative: the caller owns the live region
// (the composer row is `role="status"`), so nothing is announced twice.
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/** Orbit: cell index -> wave unit (null = the hole in the middle). */
const ORBIT = [0, 1, 2, 7, null, 3, 6, 5, 4];
/** Per-unit phase: upstream `step` (90ms) x the orbit pattern's scale (1.2). */
const UNIT_MS = 108;
/** Cells drawn when the task resolves (upstream MARKS[3]). */
const MARKS = { done: [2, 3, 5, 7], error: [0, 2, 4, 6, 8] };

export type LatticeStatus = "working" | "done" | "error";

/** Stopwatch text at 0.1s resolution: `4.2s`, `1m 4.2s` (upstream `fmt`). */
export function formatLatticeTime(deciseconds: number): string {
  const safe = Math.max(0, Math.floor(deciseconds));
  if (safe < 600) return `${(safe / 10).toFixed(1)}s`;
  return `${Math.floor(safe / 600)}m ${((safe % 600) / 10).toFixed(1)}s`;
}

interface LatticeLoaderProps {
  /** working keeps the wave running; done/error stop it and draw the mark. */
  status?: LatticeStatus;
  /** Verb shown while working. */
  label: string;
  /** Replaces the label once the task resolves. */
  doneLabel?: string;
  errorLabel?: string;
  /** Epoch ms the current task started; the loader runs its own stopwatch. */
  startedAt?: number | null;
  /** Frozen duration in seconds — wins over `startedAt` for terminal states. */
  elapsedSeconds?: number | null;
  /** Cell size in px (the grid is 3 cells plus 2 gaps). */
  cellSize?: number;
  gap?: number;
  showTimer?: boolean;
  className?: string;
}

export function LatticeLoader({
  status = "working",
  label,
  doneLabel,
  errorLabel,
  startedAt = null,
  elapsedSeconds = null,
  cellSize = 6,
  gap = 2,
  showTimer = true,
  className,
}: LatticeLoaderProps) {
  const [deciseconds, setDeciseconds] = useState(0);
  const anchorRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "working" || elapsedSeconds != null) return undefined;
    anchorRef.current = startedAt ?? Date.now();
    setDeciseconds(0);
    const tick = () => {
      const anchor = anchorRef.current ?? Date.now();
      setDeciseconds(Math.max(0, Math.floor((Date.now() - anchor) / 100)));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [status, startedAt, elapsedSeconds]);

  const shown = elapsedSeconds != null ? Math.round(elapsedSeconds * 10) : deciseconds;
  const mark = status === "working" ? "done" : status;

  return (
    <span
      data-effects="lattice-loader"
      data-status={status}
      className={className}
      style={{
        "--effects-lattice-cell": `${cellSize}px`,
        "--effects-lattice-gap": `${gap}px`,
      } as CSSProperties}
    >
      <span className="effects-lattice-grid" aria-hidden="true">
        <span className="effects-lattice-layer effects-lattice-run">
          {ORBIT.map((unit, index) => (
            <span
              key={index}
              className="effects-lattice-cell"
              data-hole={unit == null ? "" : undefined}
              style={unit == null ? undefined : { animationDelay: `${unit * UNIT_MS}ms` }}
            />
          ))}
        </span>
        <span className="effects-lattice-layer effects-lattice-mark">
          {ORBIT.map((_, index) => (
            <span
              key={index}
              className="effects-lattice-cell"
              data-on={MARKS[mark].includes(index) ? "" : undefined}
            />
          ))}
        </span>
      </span>
      <span className="effects-lattice-label">
        {/* Inactive labels stay mounted for the blur cross-fade, so they must be
            hidden from the live region: only the active one is announced. */}
        <span
          className="effects-lattice-text"
          data-active={status === "working" ? "" : undefined}
          aria-hidden={status === "working" ? undefined : "true"}
        >
          {label}
        </span>
        {doneLabel ? (
          <span
            className="effects-lattice-text"
            data-active={status === "done" ? "" : undefined}
            aria-hidden={status === "done" ? undefined : "true"}
          >
            {doneLabel}
          </span>
        ) : null}
        {errorLabel ? (
          <span
            className="effects-lattice-text"
            data-active={status === "error" ? "" : undefined}
            aria-hidden={status === "error" ? undefined : "true"}
          >
            {errorLabel}
          </span>
        ) : null}
      </span>
      {showTimer ? (
        <span className="effects-lattice-timer" aria-hidden="true">
          {formatLatticeTime(shown)}
        </span>
      ) : null}
    </span>
  );
}
