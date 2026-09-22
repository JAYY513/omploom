// Adapted from SwipeToast (react-bits by DavidHDev, MIT License).
// The original drags with motion/react springs and burns a WAAPI fuse; this
// port keeps the same contract — swipe down on a flick or a distance to
// dismiss, a hairline fuse that shows exactly the remaining time, hover /
// focus / hidden-tab pause, and an inline mode that collapses inside any
// container — using pointer events + CSS transitions. Colors come from design
// tokens instead of the upstream hex defaults.
//
// `duration` is read once per instance: notices never change their lifetime
// mid-flight, and re-arming it would let the fuse and the timer drift apart.
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

export type SwipeToastCloseReason =
  | "timeout"
  | "swipe"
  | "action"
  | "close"
  | "escape"
  | "programmatic";
export type SwipeToastPhase = "open" | "closing" | "gone";

export interface SwipeToastProps {
  title: ReactNode;
  description?: ReactNode;
  /** Decorative status glyph rendered left of the title. */
  icon?: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
  /** `false` starts the exit; the instance is not meant to re-open. */
  open?: boolean;
  onClose?: (reason: SwipeToastCloseReason) => void;
  /** Fuse + auto-dismiss in ms. 0 = sticky, no fuse. */
  duration?: number;
  /** Collapse inside the container (composer shelf) instead of leaving the flow. */
  inline?: boolean;
  /** Clamp the title: 1 = single line with ellipsis, n = n lines. */
  titleClamp?: number;
  className?: string;
  style?: CSSProperties;
}

/** Lift exit — must match the transition in the `[data-effects="swipe-toast"]` block. */
export const SWIPE_TOAST_CLOSE_MS = 240;
/** Extra beat for the inline grid row to collapse after the lift is gone. */
export const SWIPE_TOAST_COLLAPSE_MS = 220;

const FLICK = 0.11; // px/ms
const DEAD_ZONE = 3;
const RESIST_PX = 24;

/** Upstream's rubber band: an upward pull resists instead of detaching. */
export function swipeToastRubberband(over: number, dim: number, c = 0.55): number {
  return (over * dim * c) / (dim + c * Math.abs(over));
}

/** Signed px/ms over the last few samples; 0 once the hand has been still. */
export function swipeToastVelocity(
  history: ReadonlyArray<[number, number]>,
  now: number,
): number {
  if (history.length < 2) return 0;
  const [t0, y0] = history[0];
  const [t1, y1] = history[history.length - 1];
  if (now - t1 > 100) return 0;
  return (y1 - y0) / Math.max(1, t1 - t0);
}

/** A downward flick, or a past-the-threshold drag that is not pulling back up. */
export function swipeToastShouldDismiss(dy: number, velocity: number, distance = 40): boolean {
  return dy > 0 && (velocity > FLICK || (dy >= distance && velocity >= 0));
}

export function SwipeToast({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  open = true,
  onClose,
  duration = 0,
  inline = false,
  titleClamp,
  className,
  style,
}: SwipeToastProps) {
  const [phase, setPhase] = useState<SwipeToastPhase>(open ? "open" : "gone");
  const [mounted, setMounted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: number;
    startY: number;
    grab: number | null;
    hist: Array<[number, number]>;
  } | null>(null);
  const flags = useRef({ hover: false, focus: false, hidden: false });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const reasonRef = useRef<SwipeToastCloseReason>(open ? "close" : "programmatic");
  const remainingRef = useRef(duration);
  const latest = useRef({ onClose, onAction });
  latest.current = { onClose, onAction };

  const close = useCallback((reason: SwipeToastCloseReason) => {
    if (phaseRef.current !== "open") return;
    reasonRef.current = reason;
    setPhase("closing");
  }, []);
  const closeRef = useRef(close);
  closeRef.current = close;

  const syncPaused = useCallback(() => {
    const next = flags.current.hover || flags.current.focus || flags.current.hidden;
    setPaused((current) => (current === next ? current : next));
  }, []);

  // Enter: one frame at the off-screen position, then transition in.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open) closeRef.current("programmatic");
  }, [open]);

  // Fuse timer. Pausing keeps the leftover in `remainingRef` so the visual fuse
  // (which pauses by CSS) and this timer stay on the same clock.
  useEffect(() => {
    if (phase !== "open" || duration <= 0 || paused) return;
    const leftover = remainingRef.current;
    if (leftover <= 0) {
      closeRef.current("timeout");
      return;
    }
    const deadline = Date.now() + leftover;
    const timer = window.setTimeout(() => closeRef.current("timeout"), leftover);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, deadline - Date.now());
    };
  }, [phase, duration, paused]);

  // Exit: the lift slides out first, then the inline row collapses, then the
  // caller hears about it. Cleanup covers unmount and a superseded close.
  useEffect(() => {
    if (phase !== "closing") return;
    const timer = window.setTimeout(() => setPhase("gone"), SWIPE_TOAST_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "gone") return;
    if (!inline) {
      latest.current.onClose?.(reasonRef.current);
      return;
    }
    const timer = window.setTimeout(
      () => latest.current.onClose?.(reasonRef.current),
      SWIPE_TOAST_COLLAPSE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [phase, inline]);

  useEffect(() => {
    const onVisibility = () => {
      flags.current.hidden = document.hidden;
      syncPaused();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [syncPaused]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    // Buttons keep their own press behaviour (dismiss / action).
    if ((event.target as HTMLElement).closest("button")) return;
    if (phaseRef.current !== "open") return;
    try {
      cardRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort (jsdom, exotic pointers).
    }
    dragRef.current = {
      id: event.pointerId,
      startY: event.clientY,
      grab: null,
      hist: [[performance.now(), 0]],
    };
    flags.current.hover = false;
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.grab === null) {
      if (Math.abs(event.clientY - drag.startY) < DEAD_ZONE) return;
      drag.grab = event.clientY - dragY;
    }
    const raw = event.clientY - drag.grab;
    const next = raw >= 0 ? raw : swipeToastRubberband(raw, RESIST_PX);
    setDragY(next);
    drag.hist.push([performance.now(), next]);
    if (drag.hist.length > 4) drag.hist.shift();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragRef.current = null;
    try {
      cardRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already be gone.
    }
    setDragging(false);
    const velocity = swipeToastVelocity(drag.hist, performance.now());
    if (swipeToastShouldDismiss(dragY, velocity)) {
      closeRef.current("swipe");
      return;
    }
    setDragY(0);
  };

  const titleStyle: CSSProperties = titleClamp
    ? {
        display: "-webkit-box",
        WebkitLineClamp: titleClamp,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        overflowWrap: "anywhere",
        whiteSpace: "normal",
      }
    : { overflowWrap: "anywhere" };

  return (
    <div
      data-effects="swipe-toast"
      data-phase={phase}
      data-mounted={mounted ? "true" : "false"}
      data-paused={paused ? "true" : "false"}
      data-inline={inline ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-fuse={duration > 0 ? "true" : "false"}
      className={className}
      style={
        {
          "--st-duration": `${duration}ms`,
          "--st-drag": `${dragY}px`,
          ...style,
        } as CSSProperties
      }
    >
      <div className="swipe-toast__gate">
        <div className="swipe-toast__lift">
          <div
            ref={cardRef}
            className="swipe-toast__card"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerEnter={(event) => {
              if (event.pointerType !== "mouse") return;
              flags.current.hover = true;
              syncPaused();
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== "mouse") return;
              flags.current.hover = false;
              syncPaused();
            }}
            onFocus={() => {
              flags.current.focus = true;
              syncPaused();
            }}
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              flags.current.focus = false;
              syncPaused();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              closeRef.current("escape");
            }}
          >
            {icon ? (
              <span className="swipe-toast__icon" aria-hidden>
                {icon}
              </span>
            ) : null}
            <span className="swipe-toast__body">
              <span
                className="swipe-toast__title"
                style={titleStyle}
                title={titleClamp && typeof title === "string" ? title : undefined}
              >
                {title}
              </span>
              {description ? <span className="swipe-toast__desc">{description}</span> : null}
            </span>
            {actionLabel ? (
              <button
                type="button"
                className="swipe-toast__action"
                onClick={() => {
                  latest.current.onAction?.();
                  closeRef.current("action");
                }}
              >
                {actionLabel}
              </button>
            ) : null}
            <button
              type="button"
              className="swipe-toast__close"
              aria-label="Dismiss"
              onClick={() => closeRef.current("close")}
            >
              <X size={12} strokeWidth={2.5} aria-hidden />
            </button>
            {duration > 0 ? <i className="swipe-toast__fuse" aria-hidden /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
