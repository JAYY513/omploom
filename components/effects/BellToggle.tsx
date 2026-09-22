// Adapted from BellToggle (react-bits by DavidHDev, MIT License).
// The original measures label widths with a ResizeObserver, animates a
// clip-path unfurl on a spring and rings the bell on damped WAAPI keyframes;
// this port keeps the same three-part receipt — the bell swings, the pill
// unfurls to the longer label through a 0fr→1fr grid, and the badge pops its
// digit — with CSS only, tokens instead of the upstream hex defaults, and the
// lucide bell instead of Hugeicons. Trimmed from upstream: the radiating wave
// arcs and the icon slot.
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bell } from "lucide-react";

export type BellToggleSize = "sm" | "md";

export interface BellToggleProps {
  /** Label while the toggle is off. */
  offLabel: string;
  /** Label while the toggle is on — the pressed state is the receipt. */
  onLabel: string;
  /** Controlled pressed state; omit and the toggle keeps its own. */
  pressed?: boolean;
  defaultPressed?: boolean;
  onChange?: (pressed: boolean) => void;
  size?: BellToggleSize;
  /** Count shown in the badge while on (capped at "9+"). */
  count?: number;
  /** Render the count badge. */
  badge?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/** Must match the `bell-toggle-ring` animation duration. */
export const BELL_TOGGLE_RING_MS = 820;

const SIZES: Record<BellToggleSize, { height: number; font: number; icon: number; pad: number; gap: number }> = {
  sm: { height: 26, font: 11, icon: 13, pad: 8, gap: 6 },
  md: { height: 32, font: 12, icon: 15, pad: 11, gap: 8 },
};

export function BellToggle({
  offLabel,
  onLabel,
  pressed,
  defaultPressed = false,
  onChange,
  size = "md",
  count = 0,
  badge = true,
  disabled = false,
  title,
  className,
  style,
}: BellToggleProps) {
  const [inner, setInner] = useState(defaultPressed);
  const on = pressed ?? inner;
  const [ringing, setRinging] = useState(false);
  const prevCount = useRef(count);
  const preset = SIZES[size] ?? SIZES.md;

  useEffect(() => {
    if (!ringing) return;
    const timer = window.setTimeout(() => setRinging(false), BELL_TOGGLE_RING_MS);
    return () => window.clearTimeout(timer);
  }, [ringing]);

  // A count that grew while switched on gets a small wobble instead of a full ring.
  useEffect(() => {
    const grew = count > prevCount.current;
    prevCount.current = count;
    if (grew && on) setRinging(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const toggle = () => {
    if (disabled) return;
    const next = !on;
    if (pressed === undefined) setInner(next);
    if (next) setRinging(true);
    onChange?.(next);
  };

  const label = on ? onLabel : offLabel;

  return (
    <span
      data-effects="bell-toggle"
      data-on={on ? "true" : "false"}
      data-size={size}
      className={className}
      style={
        {
          "--bt-h": `${preset.height}px`,
          "--bt-fs": `${preset.font}px`,
          "--bt-icon": `${preset.icon}px`,
          "--bt-px": `${preset.pad}px`,
          "--bt-gap": `${preset.gap}px`,
          ...style,
        } as CSSProperties
      }
    >
      <button
        type="button"
        className="bell-toggle__button"
        aria-pressed={on}
        aria-label={label}
        title={title}
        disabled={disabled}
        onClick={toggle}
      >
        <span className="bell-toggle__bell" aria-hidden>
          <Bell
            size={preset.icon}
            strokeWidth={2}
            className="bell-toggle__glyph"
            data-ringing={ringing ? "true" : undefined}
          />
          {badge && on && count > 0 ? (
            <span className="bell-toggle__badge">
              <span key={count} className="bell-toggle__digit">
                {count > 9 ? "9+" : count}
              </span>
            </span>
          ) : null}
        </span>
        <span className="bell-toggle__say" aria-hidden>
          <span className="bell-toggle__slot" data-active={!on}>
            <span className="bell-toggle__face">{offLabel}</span>
          </span>
          <span className="bell-toggle__slot" data-active={on}>
            <span className="bell-toggle__face">{onLabel}</span>
          </span>
        </span>
      </button>
    </span>
  );
}
