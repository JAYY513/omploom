// Adapted from GlideSelect (react-bits by DavidHDev, MIT License).
// Behavior parity: combobox trigger (pointerdown toggle, keyboard open),
// press-drag scrub across the list (pointer capture, commit on release),
// hover/keyboard pill that glides between rows, pop-in menu, swap-blur
// label, typeahead, rememberPosition. Retinted to design tokens and
// portaled to document.body (fixed position, viewport flip, scroll/resize
// follow) so overflow:hidden cards never clip the menu.
// Divergences: token palette instead of color props (accent/surface/
// highlight/text map to app tokens); disabled options supported; list
// scrolls (touch drag scrolls; scrub is mouse/pen). Radius/durations match
// upstream (radius-4 inner, 180/120ms pop, 220ms glide).
"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface GlideSelectOption {
  value: string;
  label: ReactNode;
  tag?: string;
  disabled?: boolean;
}

interface GlideSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<string | GlideSelectOption>;
  placeholder?: string;
  showTags?: boolean;
  rememberPosition?: boolean;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  menuWidth?: number;
  placement?: "top" | "bottom";
  align?: "start" | "end";
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  invalid?: boolean;
  className?: string;
  style?: CSSProperties;
}

type Phase = "open" | "closing";

const STEP: Record<string, number> = { sm: 27, md: 31, lg: 41 };
const PAD = 4;
const MENU_MAX_HEIGHT = 260;
const MENU_MARGIN = 6;
const VIEWPORT_PAD = 8;
const CLOSE_POP_MS = 150;

const norm = (o: string | GlideSelectOption): GlideSelectOption =>
  (typeof o === "string" ? { value: o, label: o } : o);
const textOf = (it: GlideSelectOption): string =>
  (typeof it.label === "string" ? it.label : it.value);

function typeaheadIndex(items: GlideSelectOption[], from: number, ch: string): number {
  const c = ch.toLowerCase();
  for (let k = 1; k <= items.length; k += 1) {
    const i = (from + k) % items.length;
    if (!items[i].disabled && textOf(items[i]).toLowerCase().startsWith(c)) return i;
  }
  return from;
}

export function GlideSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  showTags = true,
  rememberPosition = true,
  disabled = false,
  size = "md",
  menuWidth = 176,
  placement = "bottom",
  align = "start",
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
  invalid = false,
  className,
  style,
}: GlideSelectProps) {
  const items = options.map(norm);
  const selected = items.findIndex((it) => it.value === value);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [side, setSide] = useState<"top" | "bottom">(placement);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const instantRef = useRef(false);
  const scrubRef = useRef<{ id: number; top: number } | null>(null);
  const suppressClickRef = useRef(false);
  const lastToggleRef = useRef(0);
  const autoId = useId();
  const listId = `${autoId}-list`;
  const step = STEP[size] ?? STEP.md;
  const open = phase !== null;

  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearCloseTimer = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  const computePos = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const r = anchor.getBoundingClientRect();
    // --ui-scale / zoom makes getBoundingClientRect() scaled while offsetWidth
    // is unscaled; convert to unscaled CSS px so the fixed menu lands correctly.
    let scale = 1;
    if (typeof document !== "undefined") {
      const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale"));
      if (Number.isFinite(v) && v > 0) scale = v;
    }
    const ru = scale !== 1
      ? { top: r.top / scale, right: r.right / scale, bottom: r.bottom / scale, left: r.left / scale, width: r.width / scale }
      : r;
    const width = Math.max(ru.width, menuWidth);
    const height = Math.min(menu.offsetHeight || MENU_MAX_HEIGHT, MENU_MAX_HEIGHT);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = vh - ru.bottom;
    const above = ru.top;
    let nextSide = placement;
    if (placement === "bottom" && below < height + MENU_MARGIN && above > below) nextSide = "top";
    else if (placement === "top" && above < height + MENU_MARGIN && below > above) nextSide = "bottom";
    let top = nextSide === "bottom" ? ru.bottom + MENU_MARGIN : ru.top - height - MENU_MARGIN;
    top = Math.max(VIEWPORT_PAD, Math.min(top, vh - height - VIEWPORT_PAD));
    const rawLeft = align === "start" ? ru.left : ru.right - width;
    const left = Math.max(VIEWPORT_PAD, Math.min(rawLeft, vw - width - VIEWPORT_PAD));
    setSide(nextSide);
    setPos({ top, left, width });
  }, [align, menuWidth, placement]);

  const doOpen = useCallback((viaKey: boolean) => {
    if (disabled) return;
    clearCloseTimer();
    scrubRef.current = null;
    instantRef.current = true;
    setActive(selected >= 0 ? selected : viaKey ? 0 : null);
    setPhase("open");
  }, [clearCloseTimer, disabled, selected]);

  const doClose = useCallback((mode: "instant" | "pop") => {
    setActive(null);
    clearCloseTimer();
    scrubRef.current = null;
    if (mode === "instant" || !menuRef.current) {
      setPhase(null);
      return;
    }
    setPhase("closing");
    closeTimer.current = setTimeout(() => setPhase(null), CLOSE_POP_MS + 20);
  }, [clearCloseTimer]);

  const pick = useCallback((i: number, viaKey: boolean) => {
    const it = items[i];
    if (!it || it.disabled) return;
    if (it.value !== value) {
      onChange(it.value);
      if (!viaKey && rootRef.current) rootRef.current.dataset.swap = "";
    }
    doClose("instant");
    anchorRef.current?.focus({ preventScroll: true });
  }, [items, value, onChange, doClose]);

  const rowAt = (clientY: number): number | null => {
    const s = scrubRef.current;
    if (!s) return null;
    const i = Math.floor((clientY - s.top - PAD) / step);
    return i >= 0 && i < items.length ? i : null;
  };

  const onListDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Touch drags scroll the capped list; mouse/pen press-drag scrubs.
    if (e.pointerType === "touch" || scrubRef.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom / no pointer capture: moves still arrive on the list.
    }
    scrubRef.current = { id: e.pointerId, top: e.currentTarget.getBoundingClientRect().top };
    instantRef.current = true;
    const i = rowAt(e.clientY);
    if (i !== null && i !== active && !items[i].disabled) setActive(i);
  };
  const onListMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = scrubRef.current;
    if (!s) return;
    const i = rowAt(e.clientY);
    if (i !== null && i !== active && !items[i].disabled) setActive(i);
  };
  const onListUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // setPointerCapture retargets the release to the capturing list; prefer
    // the row under the pointer, fall back to scrub math.
    const row = (e.target as HTMLElement).closest?.("[data-index]");
    const byTarget = row ? Number(row.getAttribute("data-index")) : null;
    const s = scrubRef.current;
    if (!s) return;
    if (e.type === "pointercancel") {
      if (!rememberPosition) setActive(null);
      return;
    }
    if (s.id !== e.pointerId && e.pointerId > 1) return;
    scrubRef.current = null;
    suppressClickRef.current = e.type === "pointerup";
    const i = byTarget ?? (e.type === "pointerup" ? rowAt(e.clientY) : null);
    if (i !== null && !items[i].disabled) pick(i, false);
    else if (!rememberPosition) setActive(null);
  };

  // Measure + flip on open; follow scroll/resize while open.
  useLayoutEffect(() => {
    if (phase !== "open") return;
    computePos();
    const update = () => computePos();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [phase, computePos]);

  // Glide the pill to the active row; jump (no slide) on open.
  useLayoutEffect(() => {
    const p = pillRef.current;
    if (!p || phase !== "open") return;
    if (active === null) {
      p.style.opacity = "0";
      return;
    }
    const jump = instantRef.current || p.style.opacity !== "1";
    p.style.transitionDuration = jump ? "0ms, 150ms" : "";
    p.style.transform = `translateY(${active * step}px)`;
    p.style.opacity = "1";
    instantRef.current = false;
  }, [active, phase, step]);

  // Keep the keyboard-driven row in view inside the scrollable list.
  useEffect(() => {
    if (phase !== "open" || active === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    try {
      row?.scrollIntoView?.({ block: "nearest" });
    } catch {
      // jsdom: scrolling is unimplemented; selection state is unaffected.
    }
  }, [active, phase]);

  // Outside press closes with a pop; Escape closes without reaching global handlers.
  useEffect(() => {
    if (phase === null) return undefined;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      doClose("pop");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      doClose("instant");
      anchorRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [phase, doClose]);

  useEffect(() => {
    if (disabled && phase !== null) doClose("instant");
  }, [disabled, phase, doClose]);

  const move = (dir: 1 | -1) => {
    if (items.length === 0) return;
    let i = active ?? Math.max(0, selected);
    for (let k = 0; k < items.length; k += 1) {
      i = (i + dir + items.length) % items.length;
      if (!items[i].disabled) {
        instantRef.current = false;
        setActive(i);
        return;
      }
    }
  };

  const onTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const k = e.key;
    if (phase === null) {
      if (k === "Enter" || k === " " || k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        doOpen(true);
      }
      return;
    }
    if (k === "ArrowDown") { e.preventDefault(); move(1); }
    else if (k === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (k === "Home") { e.preventDefault(); const i = items.findIndex((it) => !it.disabled); if (i >= 0) setActive(i); }
    else if (k === "End") { e.preventDefault(); for (let i = items.length - 1; i >= 0; i -= 1) { if (!items[i].disabled) { setActive(i); break; } } }
    else if (k === "Enter" || k === " ") { e.preventDefault(); pick(active ?? Math.max(0, selected), true); }
    else if (k === "Escape" || k === "Tab") {
      if (k === "Escape") { e.preventDefault(); e.stopPropagation(); }
      doClose("instant");
    } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setActive(typeaheadIndex(items, active ?? Math.max(0, selected), k));
    }
  };

  const listLabel = ariaLabel ?? (typeof placeholder === "string" ? placeholder : "Select");

  return (
    <div
      ref={rootRef}
      data-size={size}
      data-disabled={disabled ? "" : undefined}
      className={className ? `glide-select ${className}` : "glide-select"}
      style={style}
      onAnimationEnd={(e) => {
        if (e.animationName === "glide-swap" && rootRef.current) delete rootRef.current.dataset.swap;
      }}
    >
      <button
        ref={anchorRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active !== null ? `${autoId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        data-invalid={invalid ? "" : undefined}
        className="glide-select__trigger"
        onPointerDown={(e) => {
          if (e.button !== 0 || disabled) return;
          lastToggleRef.current = Date.now();
          e.currentTarget.focus({ preventScroll: true });
          if (open) doClose("pop");
          else doOpen(false);
        }}
        onClick={() => {
          if (disabled) return;
          // Testing Library / keyboard click path: no pointerdown precedes.
          if (Date.now() - lastToggleRef.current < 500) return;
          if (open) doClose("pop");
          else doOpen(false);
        }}
        onKeyDown={onTriggerKey}
      >
        <span className="glide-select__label" key={value} data-empty={selected < 0 ? "" : undefined}>
          {selected >= 0 ? items[selected].label : placeholder}
        </span>
        <span className="glide-select__chevron" aria-hidden="true">
          <ChevronDown size={12} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          data-size={size}
          data-state={phase}
          data-side={side}
          data-align={align}
          className="glide-select__menu"
          style={{
            top: pos ? pos.top : -9999,
            left: pos ? pos.left : -9999,
            width: pos ? pos.width : menuWidth,
            visibility: pos ? "visible" : "hidden",
            transformOrigin: `${side === "bottom" ? "top" : "bottom"} ${align === "start" ? "left" : "right"}`,
          } as CSSProperties}
        >
          <div
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label={listLabel}
            className="glide-select__list"
            data-live={active !== null ? "" : undefined}
            onPointerOver={(e) => {
              if (e.pointerType === "touch" || scrubRef.current) return;
              const row = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
              if (!row) return;
              const i = Number(row.dataset.index);
              if (i !== active && !items[i].disabled) setActive(i);
            }}
            onPointerLeave={() => {
              if (!scrubRef.current && !rememberPosition) setActive(null);
            }}
            onPointerDown={onListDown}
            onPointerMove={onListMove}
            onPointerUp={onListUp}
            onPointerCancel={onListUp}
            onLostPointerCapture={onListUp}
            onClickCapture={(e) => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                e.stopPropagation();
              }
            }}
          >
            <span ref={pillRef} className="glide-select__pill" aria-hidden="true" />
            {items.map((it, i) => (
              <div
                key={it.value}
                id={`${autoId}-${i}`}
                role="option"
                aria-selected={i === selected}
                aria-disabled={it.disabled || undefined}
                data-index={i}
                data-disabled={it.disabled ? "" : undefined}
                className="glide-select__option"
                onMouseEnter={() => { if (!it.disabled && !scrubRef.current) setActive(i); }}
                onClick={() => { if (suppressClickRef.current) { suppressClickRef.current = false; return; } pick(i, false); }}
              >
                <span className="glide-select__name">{it.label}</span>
                {showTags && it.tag ? <span className="glide-select__tag">{it.tag}</span> : null}
                <span className="glide-select__check" data-on={i === selected ? "" : undefined} aria-hidden="true">
                  <Check size={13} strokeWidth={2.5} aria-hidden="true" />
                </span>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
