// Adapted from ClickSpark (react-bits by DavidHDev, MIT License).
// Behavior parity (canvas 2D radial spark burst on click); defaults retinted
// from #fff to the accent token so sparks stay visible on light surfaces.
// A single rAF loop per mounted instance, idle when no sparks are alive.
"use client";

import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from "react";

interface ClickSparkProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  sparkColor?: string;
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  duration?: number;
  extraScale?: number;
}

interface Spark {
  x: number;
  y: number;
  angle: number;
  startTime: number;
}

export function ClickSpark({
  children,
  className,
  style,
  sparkColor = "var(--accent)",
  sparkSize = 8,
  sparkRadius = 18,
  sparkCount = 8,
  duration = 400,
  extraScale = 1.0,
}: ClickSparkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);
  const rafRef = useRef<number | null>(null);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    resize();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    ro?.observe(parent);
    return () => {
      ro?.disconnect();
      stopLoop();
    };
  }, [stopLoop]);

  useEffect(() => stopLoop, [stopLoop]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      rafRef.current = null;
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const now = performance.now();
    sparksRef.current = sparksRef.current.filter((spark) => now - spark.startTime < duration);
    for (const spark of sparksRef.current) {
      const elapsed = now - spark.startTime;
      const progress = Math.min(1, elapsed / duration);
      // ease-out quad (original default easing).
      const eased = progress * (2 - progress);
      const distance = eased * sparkRadius * extraScale;
      const lineLength = Math.max(0.5, sparkSize * (1 - eased));
      const alpha = 1 - eased;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = sparkColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(
        spark.x + distance * Math.cos(spark.angle),
        spark.y + distance * Math.sin(spark.angle),
      );
      ctx.lineTo(
        spark.x + (distance + lineLength) * Math.cos(spark.angle),
        spark.y + (distance + lineLength) * Math.sin(spark.angle),
      );
      ctx.stroke();
      ctx.restore();
    }
    if (sparksRef.current.length > 0) {
      rafRef.current = requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      rafRef.current = null;
    }
  }, [duration, extraScale, sparkColor, sparkRadius, sparkSize]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLSpanElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const now = performance.now();
      const origin = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      for (let i = 0; i < sparkCount; i += 1) {
        sparksRef.current.push({
          ...origin,
          angle: (2 * Math.PI * i) / sparkCount,
          startTime: now,
        });
      }
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(draw);
      }
    },
    [draw, sparkCount],
  );

  return (
    <span
      data-effects="click-spark"
      className={className}
      style={{ position: "relative", display: "inline-flex", ...style }}
      onClick={handleClick}
    >
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </span>
  );
}
