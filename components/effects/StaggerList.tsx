// Adapted from AnimatedList (react-bits by DavidHDev, MIT License).
// The original animates per-row scale with motion/react inview tracking;
// this port renders a static stagger entrance (CSS animation-delay per child,
// plays once on mount) with no scroll or keyboard machinery — sidebar rows own
// their selection and scrolling. Reduced-motion renders rows statically.
"use client";

import {
  Children,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface StaggerListProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Stagger between rows in ms. */
  stagger?: number;
  itemClassName?: string;
}

export function StaggerList({
  children,
  className,
  style,
  stagger = 28,
  itemClassName,
}: StaggerListProps) {
  const reduced = usePrefersReducedMotion();
  const items = Children.toArray(children);

  return (
    <div data-effects="stagger-list" className={className} style={style}>
      {items.map((child, index) => {
        if (!isValidElement(child)) return child;
        const existing = child as ReactElement<{ className?: string; style?: CSSProperties }>;
        return (
          <div
            key={existing.key ?? index}
            data-effects="stagger-item"
            className={reduced ? itemClassName : `effects-stagger-item ${itemClassName ?? ""}`}
            style={reduced ? undefined : { animationDelay: `${index * stagger}ms` }}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}
