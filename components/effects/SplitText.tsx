// Adapted from SplitText (react-bits by DavidHDev, MIT License).
// The original splits with gsap SplitText + ScrollTrigger; this port renders a
// static per-char/word stagger with a CSS animation (plays once on mount).
// Static headings only — never wrap streaming message content.
"use client";

import type { CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface SplitTextProps {
  text: string;
  className?: string;
  style?: CSSProperties;
  splitType?: "chars" | "words";
  /** Stagger between units in ms (original: delay prop, default 50). */
  delay?: number;
  tag?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div";
  textAlign?: CSSProperties["textAlign"];
}

export function SplitText({
  text,
  className,
  style,
  splitType = "chars",
  delay = 22,
  tag = "h1",
  textAlign,
}: SplitTextProps) {
  const reduced = usePrefersReducedMotion();
  const Tag = tag;
  const units = splitType === "words" ? text.split(" ") : text.split("");

  return (
    <Tag
      data-effects="split-text"
      className={className}
      style={{ textAlign, overflowWrap: "break-word", ...style }}
    >
      {units.map((unit, index) => (
        <span
          key={index}
          aria-hidden={index > 0}
          className={reduced ? undefined : "effects-split-unit"}
          style={reduced ? undefined : { animationDelay: `${index * delay}ms` }}
        >
          {unit === " " ? " " : unit}
          {splitType === "words" && index < units.length - 1 ? " " : null}
        </span>
      ))}
      <span className="sr-only">{text}</span>
    </Tag>
  );
}
