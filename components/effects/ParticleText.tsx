// Adapted from ParticleText (react-bits by DavidHDev, MIT License).
// The original samples glyph alpha into a cursor-repelled particle field with
// a mount-time scatter→gather; this port keeps that full behavior with zero
// new dependencies (canvas 2D only). Palette swap: the hardcoded
// #ffffff/#8b5cf6 pair becomes --text/--accent design tokens resolved live
// from the root, so the field follows warm-paper / warm-ember / omp themes.
// Reduced-motion renders the settled glyph statically (one frame, re-sampled).
"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface ParticleTextProps {
  text: string;
  className?: string;
  style?: CSSProperties;
  particleSize?: number;
  density?: number;
  scatter?: number;
  gatherDuration?: number;
  stagger?: number;
  pointerRepel?: number;
  repelRadius?: number;
  idleDrift?: number;
  trigger?: "mount" | "hover" | "click";
  fontSize?: number | string;
  fontWeight?: number | string;
  fontFamily?: string;
  glow?: boolean;
  /** Fixed canvas height in px; width always fills the parent. */
  height?: number;
}

type Rgb = { r: number; g: number; b: number };
type Particle = {
  x: number;
  y: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  size: number;
  color: string;
  seed: number;
  depth: number;
  delay: number;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

function parseTokenColor(token: string, fallback: Rgb): Rgb {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
    };
  }
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(raw);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  return fallback;
}

function resolveFontSize(
  value: number | string,
  container: HTMLDivElement,
  fontWeight: number | string,
  fontFamily: string,
): number {
  if (typeof value === "number") return value;
  const probe = document.createElement("span");
  probe.textContent = "M";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.fontSize = value;
  probe.style.fontWeight = String(fontWeight);
  probe.style.fontFamily = fontFamily;
  container.appendChild(probe);
  const size = parseFloat(window.getComputedStyle(probe).fontSize) || 96;
  probe.remove();
  return size;
}
async function waitForFonts(font: string): Promise<void> {
  if (!("fonts" in document)) return;
  try {
    await document.fonts.load(font);
  } catch {
    // Glyph sampling still works with a fallback font.
  }
  await document.fonts.ready;
}

export function ParticleText({
  text,
  className,
  style,
  particleSize = 2,
  density = 3,
  scatter = 60,
  gatherDuration = 2600,
  stagger = 900,
  pointerRepel = 40,
  repelRadius = 120,
  idleDrift = 0.35,
  trigger = "mount",
  fontSize = 64,
  fontWeight = 800,
  fontFamily = "var(--font-mono)",
  glow = true,
  height = 120,
}: ParticleTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: Particle[] = [];
    let raf = 0;
    let resizeRaf = 0;
    let buildId = 0;
    let gathering = false;
    let gatherStart = 0;
    let alive = true;
    let width = 0;
    let reducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced) reducedMotion = true;

    const pointer = { active: false, x: 0, y: 0, smoothX: 0, smoothY: 0 };

    const startGather = (fromScatter: boolean): void => {
      if (particles.length === 0) return;
      const now = performance.now();
      const spread = reducedMotion ? 0 : scatter;
      for (const particle of particles) {
        if (fromScatter) {
          const angle = particle.seed * Math.PI * 2;
          const distance = spread * (0.35 + particle.depth * 0.75);
          particle.x =
            particle.targetX + Math.cos(angle) * distance + (particle.depth - 0.5) * spread * 0.55;
          particle.y =
            particle.targetY + Math.sin(angle) * distance + (particle.seed - 0.5) * spread * 0.55;
        }
        particle.startX = particle.x;
        particle.startY = particle.y;
        particle.delay = reducedMotion ? 0 : particle.seed * stagger;
      }
      gatherStart = now;
      gathering = true;
    };

    const drawParticle = (particle: Particle): void => {
      const size = particle.size;
      ctx.fillStyle = particle.color;
      if (size <= 2.1) {
        ctx.fillRect(particle.x - size / 2, particle.y - size / 2, size, size);
        return;
      }
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    };

    const render = (now: number): void => {
      if (!alive) return;
      ctx.clearRect(0, 0, width, height);
      if (glow && !reducedMotion) {
        ctx.shadowBlur = particleSize * 3;
        ctx.shadowColor = `rgba(${accent.r},${accent.g},${accent.b},0.8)`;
      } else {
        ctx.shadowBlur = 0;
      }
      pointer.smoothX += (pointer.x - pointer.smoothX) * 0.18;
      pointer.smoothY += (pointer.y - pointer.smoothY) * 0.18;
      let complete = true;
      for (const particle of particles) {
        let baseX = particle.targetX;
        let baseY = particle.targetY;
        let progress = 1;
        if (gathering) {
          progress = clamp01(
            (now - gatherStart - particle.delay) / Math.max(1, reducedMotion ? 1 : gatherDuration),
          );
          const eased = easeOutCubic(progress);
          baseX = particle.startX + (particle.targetX - particle.startX) * eased;
          baseY = particle.startY + (particle.targetY - particle.startY) * eased;
          if (progress < 1) complete = false;
        } else if (!reducedMotion && idleDrift > 0) {
          const driftTime = now * 0.001;
          baseX += Math.sin(driftTime * 0.9 + particle.seed * 10) * idleDrift * particle.depth;
          baseY += Math.cos(driftTime * 0.75 + particle.depth * 10) * idleDrift * particle.depth;
        }
        if (pointer.active && !reducedMotion && pointerRepel > 0 && repelRadius > 0) {
          const dx = baseX - pointer.smoothX;
          const dy = baseY - pointer.smoothY;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < repelRadius) {
            const force = Math.pow(1 - distance / repelRadius, 2) * pointerRepel;
            baseX += (dx / distance) * force;
            baseY += (dy / distance) * force;
          }
        }
        const follow = reducedMotion ? 1 : 0.22;
        particle.x += (baseX - particle.x) * follow;
        particle.y += (baseY - particle.y) * follow;
        ctx.globalAlpha = Math.min(1, Math.max(0, 0.35 + progress * 0.65));
        drawParticle(particle);
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      if (gathering && complete) gathering = false;
      raf = window.requestAnimationFrame(render);
    };

    let accent: Rgb = parseTokenColor("--accent", { r: 176, g: 62, b: 34 });
    let base: Rgb = parseTokenColor("--text", { r: 43, g: 40, b: 35 });

    const sampleText = async (): Promise<void> => {
      accent = parseTokenColor("--accent", { r: 176, g: 62, b: 34 });
      base = parseTokenColor("--text", { r: 43, g: 40, b: 35 });
      const currentBuild = ++buildId;
      const rect = container.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = "100%";
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const computed = window.getComputedStyle(container);
      const resolvedFamily =
        fontFamily === "inherit" ? computed.fontFamily || "sans-serif" : fontFamily;
      let resolvedSize = resolveFontSize(fontSize, container, fontWeight, resolvedFamily);
      let font = `${fontWeight} ${resolvedSize}px ${resolvedFamily}`;
      await waitForFonts(font);
      if (!alive || currentBuild !== buildId) return;

      const offscreen = document.createElement("canvas");
      const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
      if (!offCtx) return;
      const content = String(text || " ");
      const maxTextWidth = width * 0.92;
      offCtx.font = font;
      let metrics = offCtx.measureText(content);
      const measuredWidth = Math.max(1, metrics.width);
      if (measuredWidth > maxTextWidth) {
        resolvedSize = Math.max(18, resolvedSize * (maxTextWidth / measuredWidth));
        font = `${fontWeight} ${resolvedSize}px ${resolvedFamily}`;
        await waitForFonts(font);
        if (!alive || currentBuild !== buildId) return;
        offCtx.font = font;
        metrics = offCtx.measureText(content);
      }
      const left = Math.ceil(metrics.actualBoundingBoxLeft || 0);
      const right = Math.ceil(metrics.actualBoundingBoxRight || metrics.width);
      const ascent = Math.ceil(metrics.actualBoundingBoxAscent || resolvedSize * 0.78);
      const descent = Math.ceil(metrics.actualBoundingBoxDescent || resolvedSize * 0.22);
      const padding = Math.max(12, Math.ceil(resolvedSize * 0.08));
      const textWidth = Math.max(1, left + right);
      const textHeight = Math.max(1, ascent + descent);
      offscreen.width = textWidth + padding * 2;
      offscreen.height = textHeight + padding * 2;
      offCtx.clearRect(0, 0, offscreen.width, offscreen.height);
      offCtx.font = font;
      offCtx.textAlign = "left";
      offCtx.textBaseline = "alphabetic";
      offCtx.fillStyle = "#ffffff";
      offCtx.fillText(content, padding - left, padding + ascent);

      const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
      const step = Math.max(2, Math.floor(density));
      const targets: Array<{ x: number; y: number; alpha: number }> = [];
      for (let y = 0; y < offscreen.height; y += step) {
        for (let x = 0; x < offscreen.width; x += step) {
          const alpha = imageData.data[(y * offscreen.width + x) * 4 + 3];
          if (alpha > 40) {
            targets.push({
              x: width / 2 - offscreen.width / 2 + x,
              y: height / 2 - offscreen.height / 2 + y,
              alpha: alpha / 255,
            });
          }
        }
      }
      const maxParticles = Math.max(900, Math.min(5200, Math.floor((width * height) / 90)));
      const stride = Math.max(1, Math.ceil(targets.length / maxParticles));
      const selected = targets.filter((_, index) => index % stride === 0);
      particles = selected.map((target, index) => {
        const seed = ((index * 9301 + 49297) % 233280) / 233280;
        const depth = 0.45 + (((index * 233 + 97) % 1000) / 1000) * 0.9;
        const blend = Math.min(1, Math.max(0, (target.x / Math.max(1, width)) + (seed - 0.5) * 0.35));
        const r = Math.round(base.r + (accent.r - base.r) * blend);
        const g = Math.round(base.g + (accent.g - base.g) * blend);
        const b = Math.round(base.b + (accent.b - base.b) * blend);
        const angle = seed * Math.PI * 2;
        const distance = (reducedMotion ? 0 : scatter) * (0.35 + depth * 0.75);
        const startX =
          target.x + Math.cos(angle) * distance + (seed - 0.5) * scatter * 0.45;
        const startY =
          target.y + Math.sin(angle) * distance + (depth - 0.9) * scatter * 0.45;
        return {
          x: reducedMotion ? target.x : startX,
          y: reducedMotion ? target.y : startY,
          startX,
          startY,
          targetX: target.x,
          targetY: target.y,
          size: Math.max(0.6, particleSize * (0.75 + target.alpha * 0.45)),
          color: `rgb(${r},${g},${b})`,
          seed,
          depth,
          delay: reducedMotion ? 0 : seed * stagger,
        };
      });
      pointer.x = width / 2;
      pointer.y = height / 2;
      pointer.smoothX = pointer.x;
      pointer.smoothY = pointer.y;
      if (reducedMotion) {
        for (const particle of particles) {
          particle.x = particle.targetX;
          particle.y = particle.targetY;
          particle.startX = particle.targetX;
          particle.startY = particle.targetY;
          particle.delay = 0;
        }
        gathering = false;
      } else {
        startGather(false);
      }
      if (alive) raf = window.requestAnimationFrame(render);
    };

    const queueSample = (): void => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = window.requestAnimationFrame(() => void sampleText());
    };
    const handlePointerMove = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active = true;
    };
    const handlePointerLeave = (): void => {
      pointer.active = false;
    };
    const handlePointerEnter = (event: PointerEvent): void => {
      handlePointerMove(event);
      if (trigger === "hover") startGather(true);
    };
    const handleClick = (): void => {
      if (trigger === "click") startGather(true);
    };
    const reduceMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const handleReduceMotionChange = (event: MediaQueryListEvent): void => {
      reducedMotion = event.matches || reduced;
      void sampleText();
    };

    reduceMotionQuery?.addEventListener("change", handleReduceMotionChange);
    canvas.addEventListener("pointerenter", handlePointerEnter);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("click", handleClick);
    const resizeObserver = new ResizeObserver(queueSample);
    resizeObserver.observe(container);
    // Theme switches rewrite data-theme/class in place: re-sample the field
    // (not just the glyph) so settled particles follow the new palette.
    const themeObserver = new MutationObserver(queueSample);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    void sampleText();

    return () => {
      alive = false;
      buildId += 1;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      reduceMotionQuery?.removeEventListener("change", handleReduceMotionChange);
      canvas.removeEventListener("pointerenter", handlePointerEnter);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("click", handleClick);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(resizeRaf);
    };
  }, [
    text,
    particleSize,
    density,
    scatter,
    gatherDuration,
    stagger,
    pointerRepel,
    repelRadius,
    idleDrift,
    trigger,
    fontSize,
    fontWeight,
    fontFamily,
    glow,
    height,
    reduced,
  ]);

  return (
    <div
      ref={containerRef}
      data-effects="particle-text"
      className={className}
      style={{ position: "relative", display: "block", width: "100%", height, overflow: "hidden", ...style }}
      role="img"
      aria-label={text}
    >
      <canvas ref={canvasRef} aria-hidden style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
