"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface Props {
  /** PromptBar max-effort state: glow + rising sparks while true. */
  active: boolean;
  /** Accent color for the glow wash and spark fill (defaults to --accent). */
  color?: string;
  /** Bumps typing energy; pass the composer text. Refs avoid effect churn. */
  energySource?: string;
}

interface Spark {
  x: number;
  y: number;
  r: number;
  vy: number;
  sway: number;
  phase: number;
  life: number;
  span: number;
}

/**
 * PromptBar max-effort field effect: a radial accent wash plus small
 * sparks rising from the bottom of the composer shell. Idle-drift runs
 * on rAF; typing adds energy (faster rise, brighter glow) that decays
 * on its own. Reduced motion renders nothing; canvas is aria-hidden.
 */
export function ThinkingMaxSparks({ active, color, energySource }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const energyRef = useRef({ energy: 0, strokes: 0 });
  const prevTextRef = useRef(energySource ?? "");
  // PromptBar bumps energy on every keystroke; the rAF loop decays it.
  // Effect (not render) so StrictMode re-renders never double-count.
  useEffect(() => {
    const prev = prevTextRef.current;
    const next = energySource ?? "";
    if (next !== prev) {
      const bucket = energyRef.current;
      bucket.energy = Math.min(1.6, bucket.energy + 0.22);
      bucket.strokes = Math.min(4, bucket.strokes + 1);
    }
    prevTextRef.current = next;
  }, [energySource]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || reduceMotion || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let due = 0;
    let speed = 1;
    let pulse = 0;
    const parts: Spark[] = [];
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const spawn = (burst: boolean) => {
      parts.push({
        x: Math.random() * w,
        y: burst ? h * (0.2 + Math.random() * 0.8) : h + 3,
        r: 0.9 + Math.random() * 1.1,
        vy: -(7 + Math.random() * 9),
        sway: (Math.random() - 0.5) * 10,
        phase: Math.random() * Math.PI * 2,
        life: burst ? Math.random() * 1.2 : 0,
        span: 2.4 + Math.random() * 2.4,
      });
    };
    const accent = color ?? (getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#B03E22");
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const bucket = energyRef.current;
      bucket.energy *= Math.exp(-dt / 0.8);
      pulse *= Math.exp(-dt / 0.16);
      if (bucket.strokes > 0) {
        bucket.strokes = 0;
        pulse = 1;
      }
      const energy = bucket.energy;
      speed += (1 + energy * 6 - speed) * (1 - Math.exp(-dt / 0.15));
      due += dt;
      while (due > 0.14) {
        due -= 0.14;
        if (parts.length < 30) spawn(false);
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = accent;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 6 + energy * 10 + pulse * 6;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        p.life += dt;
        if (p.life > p.span) {
          parts.splice(i, 1);
          continue;
        }
        const k = p.life / p.span;
        const twinkle = 0.7 + 0.3 * Math.sin((now / 160) * (1 + energy) + p.phase);
        p.y += p.vy * dt * speed;
        if (p.y < -4) {
          p.y = h + 3;
          p.x = Math.random() * w;
        }
        const edge = Math.min(1, Math.max(0, p.y / 14), Math.max(0, (h - p.y) / 14));
        ctx.globalAlpha = Math.min(1, Math.sin(k * Math.PI) * (0.9 + energy * 0.25) * twinkle) * edge;
        ctx.beginPath();
        ctx.arc(
          p.x + Math.sin((now / 900) * (1 + energy * 0.8) + p.phase) * p.sway,
          p.y,
          p.r * twinkle * (1 + energy * 0.35),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    resize();
    for (let i = 0; i < 26; i += 1) spawn(true);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
  }, [active, reduceMotion, color]);

  if (!active || reduceMotion) return null;
  return <canvas ref={canvasRef} className="chat-input-max-sparks" aria-hidden="true" />;
}
