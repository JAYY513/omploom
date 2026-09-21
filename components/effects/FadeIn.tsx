// Adapted from AnimatedContent + FadeContent (react-bits by DavidHDev, MIT License).
// The originals drive the entrance with gsap + ScrollTrigger; this port uses
// IntersectionObserver + a CSS transition so omp-loom ships zero new animation
// dependencies. Plays once on first visibility; honors prefers-reduced-motion.
"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface FadeInProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Entrance slide distance in px. */
  distance?: number;
  direction?: "vertical" | "horizontal";
  reverse?: boolean;
  /** Entrance delay in ms. */
  delay?: number;
  /** Add a blur(8px) -> blur(0) leg to the entrance (FadeContent parity). */
  blur?: boolean;
  threshold?: number;
}

export function FadeIn({
  children,
  className,
  style,
  distance = 14,
  direction = "vertical",
  reverse = false,
  delay = 0,
  blur = false,
  threshold = 0.1,
}: FadeInProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, reduced]);

  const visible = shown || reduced;
  const offset = reverse ? -distance : distance;
  const hiddenTransform =
    direction === "horizontal" ? `translateX(${offset}px)` : `translateY(${offset}px)`;

  return (
    <div
      ref={ref}
      data-effects="fade-in"
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : hiddenTransform,
        filter: blur && !visible ? "blur(8px)" : "blur(0px)",
        transition:
          "opacity var(--dur-med) var(--ease-out-warm), transform var(--dur-med) var(--ease-out-warm), filter var(--dur-med) var(--ease-out-warm)",
        transitionDelay: `${delay}ms`,
        willChange: visible ? undefined : "opacity, transform, filter",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
