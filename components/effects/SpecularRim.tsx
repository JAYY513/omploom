// Adapted from SpecularButton (react-bits by DavidHDev, MIT License): the
// shader-driven rim streak, rebuilt as a masked conic gradient so the button
// keeps its own fill and the app keeps zero graphics dependencies. Only the
// angle is dynamic — CSS owns the streak geometry, JS eases one custom property
// and stops its rAF the moment the streak settles. Reduced motion keeps the
// static diagonal highlight and never starts the follow loop.
"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/** Angle easing rate (per second) — the shader's exponential steering. */
const STEER_RATE = 7;
/** Below this the streak has settled; the rAF loop stops. */
const SETTLE_DEG = 0.25;
/** conic-gradient starts at 12 o'clock; the pointer angle is measured from 3. */
const GRADIENT_OFFSET_DEG = 90;

export function SpecularRim({ className }: { className?: string }) {
  const rimRef = useRef<HTMLSpanElement>(null);
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const rim = rimRef.current;
    // The rim is decorative and sits inside its host button, so the host is the
    // pointer surface: no window listener, no per-instance state.
    const host = rim?.parentElement;
    if (!rim || !host) return undefined;

    let angle = 135;
    let target = 135;
    let frame: number | null = null;
    let last = 0;

    const paint = () => rim.style.setProperty("--spec-angle", `${angle.toFixed(2)}deg`);
    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      angle += (target - angle) * (1 - Math.exp(-dt * STEER_RATE));
      if (Math.abs(target - angle) <= SETTLE_DEG) {
        angle = target;
        paint();
        frame = null;
        return;
      }
      paint();
      frame = requestAnimationFrame(step);
    };
    const steer = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      target = (Math.atan2(dy, dx) * 180) / Math.PI + GRADIENT_OFFSET_DEG;
      if (frame === null) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    };
    // Duck-typed on purpose: referencing the HTMLButtonElement global breaks in
    // DOM shims that only expose HTMLElement (the repo's jsdom harness included).
    const enabled = () => !(host as HTMLButtonElement).disabled;
    const onEnter = (event: PointerEvent) => {
      if (!enabled()) return;
      rim.setAttribute("data-on", "");
      if (!reduceMotion) steer(event);
    };
    const onMove = (event: PointerEvent) => {
      if (reduceMotion || !enabled()) return;
      steer(event);
    };
    const onLeave = () => rim.removeAttribute("data-on");

    host.addEventListener("pointerenter", onEnter);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("pointercancel", onLeave);
    return () => {
      host.removeEventListener("pointerenter", onEnter);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointercancel", onLeave);
      stop();
    };
  }, [reduceMotion]);

  return <span ref={rimRef} data-effects="specular-rim" className={className} aria-hidden="true" />;
}
