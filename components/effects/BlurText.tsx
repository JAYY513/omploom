// Adapted from BlurText (react-bits by DavidHDev, MIT License).
// The original animates per-word keyframes with motion/react; this port uses
// IntersectionObserver + per-segment CSS transitions (same blur/y/opacity arc,
// two-step settle). Static text only — never wrap streaming message content.
"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface BlurTextProps {
  text: string;
  className?: string;
  style?: CSSProperties;
  animateBy?: "words" | "letters";
  direction?: "top" | "bottom";
  /** Stagger between segments in ms (original: delay prop, default 200). */
  delay?: number;
  threshold?: number;
}

export function BlurText({
  text,
  className,
  style,
  animateBy = "words",
  direction = "top",
  delay = 90,
  threshold = 0.1,
}: BlurTextProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [inView, setInView] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, reduced]);

  const segments = useMemo(
    () => (animateBy === "words" ? text.split(" ") : text.split("")),
    [text, animateBy],
  );
  const visible = inView || reduced;
  const hiddenY = direction === "top" ? "-0.55em" : "0.55em";

  return (
    <p ref={ref} data-effects="blur-text" className={className} style={style}>
      {segments.map((segment, index) => (
        <span
          key={index}
          aria-hidden={index > 0}
          style={{
            display: "inline-block",
            opacity: visible ? 1 : 0,
            transform: visible ? "none" : `translateY(${hiddenY})`,
            filter: visible ? "blur(0px)" : "blur(10px)",
            transition:
              "opacity var(--dur-med) var(--ease-out-warm), transform var(--dur-med) var(--ease-out-warm), filter var(--dur-med) var(--ease-out-warm)",
            transitionDelay: `${index * delay}ms`,
            willChange: visible ? undefined : "transform, filter, opacity",
          }}
        >
          {segment === " " ? " " : segment}
          {animateBy === "words" && index < segments.length - 1 ? " " : null}
        </span>
      ))}
      <span className="sr-only">{text}</span>
    </p>
  );
}
