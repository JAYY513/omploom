// Adapted from FuseButton (react-bits by DavidHDev, MIT License).
// The original drives the label crossfade and the fuse with WAAPI + Hugeicons;
// this port keeps the same contract — press arms the action, the label
// crossfades to the armed label, a hairline burns for exactly the undo window,
// and Undo or Escape runs it back — with CSS transitions + a pause-aware timer.
// Colors come from design tokens instead of the upstream hex defaults.
// Trimmed from upstream: the outline/top fuse positions and the icon slot.
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type FuseButtonPhase = "idle" | "armed" | "settled";
export type FuseButtonCommitOn = "press" | "fuseEnd";
export type FuseButtonSettle = "reset" | "stay";

export interface FuseButtonProps {
  label: ReactNode;
  /** Label while the fuse burns — the way out of a committed or pending action. */
  armedLabel?: ReactNode;
  /** Label after the fuse ends without an undo and `settle` is "stay". */
  doneLabel?: ReactNode;
  /** Undo window in ms. */
  undoWindow?: number;
  /** `press` commits at press (undo reverts it); `fuseEnd` commits when the fuse burns out. */
  commitOn?: FuseButtonCommitOn;
  /** What the button shows once the window closes: the original label, or the done label. */
  settle?: FuseButtonSettle;
  /** Start already armed — the deferred-action shape (menu arms, this confirms). */
  defaultArmed?: boolean;
  onArmedChange?: (armed: boolean) => void;
  /** Fired once the action is committed (at press, or when the fuse ends). */
  onCommit?: () => void;
  /** Fired when an armed action is taken back. */
  onUndo?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/** How long the settled label stays before `settle: "reset"` returns to idle. */
export const FUSE_BUTTON_SETTLE_MS = 900;

export function FuseButton({
  label,
  armedLabel = "Undo",
  doneLabel,
  undoWindow = 4000,
  commitOn = "press",
  settle = "reset",
  defaultArmed = false,
  onArmedChange,
  onCommit,
  onUndo,
  disabled = false,
  title,
  className,
  style,
}: FuseButtonProps) {
  const [phase, setPhase] = useState<FuseButtonPhase>(defaultArmed ? "armed" : "idle");
  const [paused, setPaused] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const remainingRef = useRef(undoWindow);
  const latest = useRef({ onArmedChange, onCommit, onUndo });
  latest.current = { onArmedChange, onCommit, onUndo };

  const go = useCallback((next: FuseButtonPhase) => {
    const wasArmed = phaseRef.current === "armed";
    phaseRef.current = next;
    setPhase(next);
    if (next === "armed") remainingRef.current = undoWindow;
    if (wasArmed !== (next === "armed")) latest.current.onArmedChange?.(next === "armed");
  }, [undoWindow]);

  const settleFrom = useCallback(
    (committed: boolean) => {
      go(settle === "stay" ? "settled" : "idle");
      remainingRef.current = undoWindow;
      if (committed) latest.current.onCommit?.();
    },
    [go, settle, undoWindow],
  );

  // Fuse timer. Hovering or focusing an armed button holds the window open (so a
  // deliberate read cannot burn through it); the visual fuse pauses with it.
  useEffect(() => {
    if (phase !== "armed" || paused || disabled) return;
    const leftover = remainingRef.current;
    if (leftover <= 0) return;
    const deadline = Date.now() + leftover;
    const timer = window.setTimeout(() => settleFrom(commitOn === "fuseEnd"), leftover);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, deadline - Date.now());
    };
  }, [phase, paused, disabled, commitOn, settleFrom]);

  // A settled receipt is not a resting state: hand the button back to idle.
  useEffect(() => {
    if (phase !== "settled") return;
    const timer = window.setTimeout(() => go("idle"), FUSE_BUTTON_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [phase, go]);

  const press = () => {
    if (disabled) return;
    if (phase === "armed") {
      latest.current.onUndo?.();
      go("idle");
      remainingRef.current = undoWindow;
      return;
    }
    if (phase === "settled") {
      go("idle");
      return;
    }
    if (commitOn === "press") latest.current.onCommit?.();
    go("armed");
  };

  const undo = () => {
    if (phaseRef.current !== "armed") return;
    latest.current.onUndo?.();
    go("idle");
    remainingRef.current = undoWindow;
  };

  const text = phase === "armed" ? armedLabel : phase === "settled" ? (doneLabel ?? label) : label;

  return (
    <button
      type="button"
      data-effects="fuse-button"
      data-phase={phase}
      data-paused={paused ? "true" : "false"}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={title}
      className={className}
      onClick={press}
      onPointerEnter={() => {
        if (phaseRef.current === "armed") setPaused(true);
      }}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => {
        if (phaseRef.current === "armed") setPaused(true);
      }}
      onBlur={() => setPaused(false)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        undo();
      }}
      style={{ "--fb-window": `${undoWindow}ms`, ...style } as CSSProperties}
    >
      <span key={phase} className="fuse-button__label">
        {text}
      </span>
      {phase === "armed" ? <i key="fuse" className="fuse-button__fuse" aria-hidden /> : null}
    </button>
  );
}
