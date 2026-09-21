// Adapted from DotGrid (react-bits by DavidHDev, MIT License).
// The original adds gsap inertia + shockwave physics on a full-viewport canvas;
// this port keeps the static dot lattice + pointer-proximity tint only (single
// rAF loop, no physics), tinted with --text-dim/--accent at --bg-subtle level
// contrast so it never competes with content. Reduced-motion renders one frame.
"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface DotGridProps {
  className?: string;
  style?: CSSProperties;
  dotSize?: number;
  gap?: number;
  proximity?: number;
  label?: string;
}

function parseTokenColor(token: string, fallback: [number, number, number]): [number, number, number] {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    return [
      parseInt(hex[1].slice(0, 2), 16),
      parseInt(hex[1].slice(2, 4), 16),
      parseInt(hex[1].slice(4, 6), 16),
    ];
  }
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(raw);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return fallback;
}

export function DotGrid({
  className,
  style,
  dotSize = 2,
  gap = 26,
  proximity = 130,
  label,
}: DotGridProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: -9999, y: -9999 });
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let dots: Array<{ x: number; y: number }> = [];
    let raf = 0;
    let alive = true;

    const base = parseTokenColor("--text-dim", [106, 100, 88]);
    const active = parseTokenColor("--accent", [176, 62, 34]);

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cell = dotSize + gap;
      dots = [];
      for (let y = cell / 2; y < height; y += cell) {
        for (let x = cell / 2; x < width; x += cell) {
          dots.push({ x, y });
        }
      }
    };

    const paint = () => {
      if (!alive) return;
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      const { x: px, y: py } = pointerRef.current;
      const radius = dotSize / 2;
      for (const dot of dots) {
        const dist = Math.hypot(dot.x - px, dot.y - py);
        const t = Math.max(0, 1 - dist / proximity);
        const r = Math.round(base[0] + (active[0] - base[0]) * t);
        const g = Math.round(base[1] + (active[1] - base[1]) * t);
        const b = Math.round(base[2] + (active[2] - base[2]) * t);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${r},${g},${b},${0.16 + t * 0.3})`;
        ctx.arc(dot.x, dot.y, radius + t * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduced) {
        raf = requestAnimationFrame(paint);
      }
    };

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };
    const onLeave = () => {
      pointerRef.current = { x: -9999, y: -9999 };
    };

    resize();
    paint();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      resize();
      if (reduced) paint();
    });
    ro?.observe(wrap);
    if (!reduced) {
      wrap.addEventListener("pointermove", onMove, { passive: true });
      wrap.addEventListener("pointerleave", onLeave);
    }
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
    };
  }, [dotSize, gap, proximity, reduced]);

  return (
    <div
      ref={wrapRef}
      data-effects="dot-grid"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      className={className}
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", ...style }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
