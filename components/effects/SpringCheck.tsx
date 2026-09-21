// Adapted from SpringCheck (react-bits by DavidHDev, MIT License).
// The original animates a springy checkbox with motion/react + a HugeIcons tick;
// this port keeps the same completed-row contract (accent fill, check draw,
// strike-through sweep) with CSS transitions. It is display-only: the row text
// and aria label stay owned by TodoList, so no checkbox semantics are implied.
"use client";

import type { CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface SpringCheckProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

export function SpringCheck({ size = 15, className, style, label }: SpringCheckProps) {
  const reduced = usePrefersReducedMotion();

  return (
    <span
      data-effects="spring-check"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: Math.max(4, size * 0.32),
        background: "var(--accent)",
        color: "var(--on-accent)",
        ...style,
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.66} height={size * 0.66} aria-hidden>
        <path
          d="M7.5 12.25 10.5 15.25 16.75 8.75"
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={reduced ? undefined : "effects-spring-draw"}
        />
      </svg>
    </span>
  );
}
