// Adapted from PromptBar's SendGlyph (react-bits by DavidHDev, MIT License).
// A single 24x24 path morphs between an up arrow and a stop square by linearly
// interpolating their 7-point polygons, with a mid-morph squash + tilt so the
// shape change reads as one pressed object instead of two swapped icons.
// PromptBar drives this with motion values; this port runs one rAF that stops
// as soon as the morph settles (same idle discipline as ClickSpark).
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/** Up arrow and stop square as 7-point polygons in a 24x24 box (PromptBar). */
const ARROW_UP = [12, 4.5, 18.5, 11, 14.25, 11, 14.25, 19.5, 9.75, 19.5, 9.75, 11, 5.5, 11];
const SQUARE = [12, 6, 18, 6, 18, 12, 18, 18, 6, 18, 6, 12, 6, 6];

/** Morph easing: cubic-bezier(0.77, 0, 0.175, 1), PromptBar's EASE_IN_OUT. */
const EASE = [0.77, 0, 0.175, 1] as const;

/** Interpolated path for morph progress t (0 = arrow, 1 = stop square). */
export function sendGlyphPath(t: number): string {
  let d = "";
  for (let i = 0; i < ARROW_UP.length; i += 2) {
    const x = ARROW_UP[i] + (SQUARE[i] - ARROW_UP[i]) * t;
    const y = ARROW_UP[i + 1] + (SQUARE[i + 1] - ARROW_UP[i + 1]) * t;
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

/** Cubic-bezier progress -> eased progress, solved by bisection. */
export function sendGlyphEase(t: number): number {
  const [x1, y1, x2, y2] = EASE;
  const axis = (u: number, a: number, b: number) =>
    3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  let low = 0;
  let high = 1;
  let u = t;
  for (let i = 0; i < 12; i += 1) {
    u = (low + high) / 2;
    if (axis(u, x1, x2) < t) low = u;
    else high = u;
  }
  return axis(u, y1, y2);
}

interface SendGlyphProps {
  /** true renders the stop square (agent running), false the send arrow. */
  busy: boolean;
  /** Morph duration in ms. */
  duration?: number;
  /** Mid-morph squash of the glyph box; 0 disables the squash/tilt flourish. */
  squash?: number;
  /** Mid-morph tilt in degrees, signed by morph direction. */
  tilt?: number;
  /** Rendered box size in px. */
  size?: number;
  className?: string;
}

export function SendGlyph({
  busy,
  duration = 240,
  squash = 0.12,
  tilt = 8,
  size = 13,
  className,
}: SendGlyphProps) {
  // Captured once: the rendered `d` must stay constant so React never fights
  // the rAF writer, and SSR/hydration agree on the same starting shape.
  const [initial] = useState(() => (busy ? 1 : 0));
  const progressRef = useRef(initial);
  const directionRef = useRef(busy ? 1 : -1);
  const pathRef = useRef<SVGPathElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number | null>(null);
  const reduceMotion = usePrefersReducedMotion();

  const paint = useCallback(
    (p: number) => {
      pathRef.current?.setAttribute("d", sendGlyphPath(p));
      const svg = svgRef.current;
      if (!svg) return;
      // The flourish lives between the endpoints only: at rest the glyph must
      // carry no transform at all (sin(pi) is 1.2e-16, not 0).
      const goo = p <= 0 || p >= 1 || !(squash || tilt) ? 0 : Math.sin(p * Math.PI);
      const scaleX = 1 - squash * goo;
      svg.style.transform = goo
        ? `rotate(${directionRef.current * tilt * goo}deg) scale(${scaleX}, ${1 / scaleX})`
        : "";
    },
    [squash, tilt],
  );

  useEffect(() => {
    const target = busy ? 1 : 0;
    const from = progressRef.current;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (from === target) return;
    directionRef.current = busy ? 1 : -1;
    if (reduceMotion || duration <= 0) {
      progressRef.current = target;
      paint(target);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      const p = from + (target - from) * sendGlyphEase(k);
      progressRef.current = p;
      paint(p);
      if (k < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
        progressRef.current = target;
        paint(target);
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [busy, duration, paint, reduceMotion]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    [],
  );

  return (
    <svg
      ref={svgRef}
      data-effects="send-glyph"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path ref={pathRef} d={sendGlyphPath(initial)} />
    </svg>
  );
}
