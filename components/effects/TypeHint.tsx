// Adapted from TextType (react-bits by DavidHDev, MIT License).
// The original loops type/delete cycles with gsap cursor blinking; this port
// types once and stops (loop is intentionally unsupported) so the hint never
// steals attention. Monospace caret included; reduced-motion renders instantly.
"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface TypeHintProps {
  text: string;
  className?: string;
  style?: CSSProperties;
  typingSpeed?: number;
  initialDelay?: number;
  showCursor?: boolean;
  as?: "div" | "p" | "span";
}

export function TypeHint({
  text,
  className,
  style,
  typingSpeed = 28,
  initialDelay = 500,
  showCursor = true,
  as = "p",
}: TypeHintProps) {
  const reduced = usePrefersReducedMotion();
  const [count, setCount] = useState(reduced ? text.length : 0);

  useEffect(() => {
    if (reduced) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let index = 0;
    let timer: number | undefined;
    const tick = () => {
      index += 1;
      setCount(index);
      if (index < text.length) {
        timer = window.setTimeout(tick, typingSpeed);
      }
    };
    timer = window.setTimeout(tick, initialDelay);
    return () => clearTimeout(timer);
  }, [initialDelay, reduced, text, typingSpeed]);

  const Tag = as;
  const done = count >= text.length;

  return (
    <Tag data-effects="type-hint" className={className} style={style}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.slice(0, count)}
        {showCursor && (
          <span
            className={done ? "effects-type-caret effects-type-caret-done" : "effects-type-caret"}
            aria-hidden
          >
            |
          </span>
        )}
      </span>
    </Tag>
  );
}
