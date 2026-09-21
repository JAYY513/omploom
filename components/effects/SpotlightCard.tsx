// Adapted from SpotlightCard (react-bits by DavidHDev, MIT License).
// Behavior parity (cursor-tracking radial glow); the hardcoded
// `rgba(255,255,255,0.25)` spotlight becomes a `--accent` token mix so the glow
// follows the warm-paper / warm-ember / omp palettes. The wrapper stays style
// neutral — callers own border, background, and radius.
"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Default glow color; accent-tinted so it stays visible on every theme. */
export const SPOTLIGHT_GLOW =
  "color-mix(in srgb, var(--accent) 18%, transparent)";

/** Radial glow background for cursor position (x, y) in element-local px. */
export function spotlightGradient(
  x: number,
  y: number,
  color: string = SPOTLIGHT_GLOW,
): string {
  return `radial-gradient(circle at ${x}px ${y}px, ${color}, transparent 70%)`;
}

/** Overlay style for rows that already track hover + cursor themselves. */
export function spotlightOverlayStyle(
  x: number,
  y: number,
  opacity: number,
  color?: string,
): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    opacity,
    transition: "opacity var(--dur-med) var(--ease-out-warm)",
    background: spotlightGradient(x, y, color),
  };
}

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  spotlightColor?: string;
}

export function SpotlightCard({
  children,
  className,
  style,
  spotlightColor = SPOTLIGHT_GLOW,
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: -400, y: -400 });
  const [opacity, setOpacity] = useState(0);

  return (
    <div
      ref={ref}
      data-effects="spotlight-card"
      className={className}
      style={{ position: "relative", overflow: "hidden", ...style }}
      onMouseMove={(event) => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        setPosition({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      }}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
    >
      <div aria-hidden style={spotlightOverlayStyle(position.x, position.y, opacity, spotlightColor)} />
      {children}
    </div>
  );
}
