// Adapted from ShinyText (react-bits by DavidHDev, MIT License).
// The original sweeps a motion-value background-position in a rAF loop; this
// port uses a CSS background-position animation scoped to the element, with the
// gray/white palette swapped for --text-dim/--accent-token sheen. `disabled`
// renders plain text (used for the settled breadcrumb title).
"use client";

import type { CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface ShinyTextProps {
  text: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  /** Sweep duration in seconds (original: speed, default 2 → ~2s... scaled). */
  speed?: number;
}

export function ShinyText({ text, className, style, disabled = false, speed = 2.4 }: ShinyTextProps) {
  const reduced = usePrefersReducedMotion();
  const plain = disabled || reduced;

  return (
    <span
      data-effects="shiny-text"
      className={plain ? className : `effects-shiny ${className ?? ""}`}
      style={
        {
          "--effects-shiny-duration": `${Math.max(0.6, speed)}s`,
          ...style,
        } as CSSProperties
      }
    >
      {text}
    </span>
  );
}
