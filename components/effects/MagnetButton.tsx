// Adapted from Magnet (react-bits by DavidHDev, MIT License).
// Behavior parity (cursor-proximity translate toward the pointer); the window
// mousemove listener is kept (same as the original) but the wrapper only
// engages on fine pointers without reduced-motion, so touch and
// reduced-motion users get a static button.
"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface MagnetButtonProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  padding?: number;
  magnetStrength?: number;
  disabled?: boolean;
}

export function MagnetButton({
  children,
  className,
  style,
  padding = 48,
  magnetStrength = 3,
  disabled = false,
}: MagnetButtonProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (disabled || reduced) {
      setOffset({ x: 0, y: 0 });
      setActive(false);
      return;
    }
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const onMove = (event: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const nearX = Math.abs(centerX - event.clientX) < rect.width / 2 + padding;
      const nearY = Math.abs(centerY - event.clientY) < rect.height / 2 + padding;
      if (nearX && nearY) {
        setActive(true);
        setOffset({
          x: (event.clientX - centerX) / magnetStrength,
          y: (event.clientY - centerY) / magnetStrength,
        });
      } else {
        setActive(false);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [disabled, magnetStrength, padding, reduced]);

  return (
    <span
      ref={ref}
      data-effects="magnet-button"
      className={className}
      style={{ display: "inline-flex", ...style }}
    >
      <span
        style={
          {
            display: "inline-flex",
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
            transition: active
              ? "transform 0.3s ease-out"
              : "transform 0.5s ease-in-out",
            willChange: active ? "transform" : undefined,
          } as CSSProperties
        }
      >
        {children}
      </span>
    </span>
  );
}
