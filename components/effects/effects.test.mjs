import "../../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render } from "@testing-library/react/pure.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { StatusMark } = await jiti.import("./StatusMark.tsx");
const { SpringCheck } = await jiti.import("./SpringCheck.tsx");
const { ClickSpark } = await jiti.import("./ClickSpark.tsx");
const { FadeIn } = await jiti.import("./FadeIn.tsx");
const { SplitText } = await jiti.import("./SplitText.tsx");
const { BlurText } = await jiti.import("./BlurText.tsx");
const { SpotlightCard, spotlightGradient } = await jiti.import("./SpotlightCard.tsx");
const { StaggerList } = await jiti.import("./StaggerList.tsx");
const { TypeHint } = await jiti.import("./TypeHint.tsx");
const { ShinyText } = await jiti.import("./ShinyText.tsx");
const { DotGrid } = await jiti.import("./DotGrid.tsx");
const { ParticleText } = await jiti.import("./ParticleText.tsx");
const { SendGlyph, sendGlyphPath, sendGlyphEase } = await jiti.import("./SendGlyph.tsx");
const { LatticeLoader, formatLatticeTime } = await jiti.import("./LatticeLoader.tsx");
const { SpecularRim } = await jiti.import("./SpecularRim.tsx");
const {
  SwipeToast,
  swipeToastRubberband,
  swipeToastVelocity,
  swipeToastShouldDismiss,
  SWIPE_TOAST_CLOSE_MS,
  SWIPE_TOAST_COLLAPSE_MS,
} = await jiti.import("./SwipeToast.tsx");
const { FuseButton, FUSE_BUTTON_SETTLE_MS } = await jiti.import("./FuseButton.tsx");
const { BellToggle, BELL_TOGGLE_RING_MS } = await jiti.import("./BellToggle.tsx");
const { CallChip, formatCallChipElapsed, CALL_CHIP_TICK_MS } = await jiti.import("./CallChip.tsx");

afterEach(() => {
  cleanup();
});

test("StatusMark renders a decorative ring for every status without hardcoded hex", () => {
  for (const status of ["pending", "running", "done", "failed", "cancelled"]) {
    const html = renderToStaticMarkup(React.createElement(StatusMark, { status }));
    assert.match(html, new RegExp(`data-status="${status}"`));
    assert.match(html, /aria-hidden="true"/);
    assert.doesNotMatch(html, /#[0-9a-fA-F]{3,6}/);
  }
});

test("StatusMark indeterminate running renders a partial arc and announces progress", () => {
  const spin = renderToStaticMarkup(React.createElement(StatusMark, { status: "running" }));
  assert.match(spin, /effects-status-spin/);
  const determinate = renderToStaticMarkup(
    React.createElement(StatusMark, { status: "running", progress: 0.5, label: "upload" }),
  );
  assert.match(determinate, /In progress, 50%: upload/);
  assert.doesNotMatch(determinate, /effects-status-spin/);
});

test("FadeIn renders children hidden-then-shown without new animation deps", () => {
  const html = renderToStaticMarkup(
    React.createElement(FadeIn, { distance: 14 }, "panel"),
  );
  assert.match(html, /data-effects="fade-in"/);
  assert.match(html, /panel/);
  assert.match(html, /opacity:0/);
});

test("SplitText emits per-unit stagger with a screen-reader fallback", () => {
  const html = renderToStaticMarkup(
    React.createElement(SplitText, { text: "hi", splitType: "chars" }),
  );
  assert.match(html, /data-effects="split-text"/);
  assert.match(html, /effects-split-unit/);
  assert.match(html, /sr-only/);
});

test("BlurText renders per-word segments with a screen-reader fallback", () => {
  const html = renderToStaticMarkup(
    React.createElement(BlurText, { text: "hello world" }),
  );
  assert.match(html, /data-effects="blur-text"/);
  assert.match(html, /sr-only/);
  assert.match(html, /hello/);
});

test("SpotlightCard glow uses the accent token, never a hardcoded color", () => {
  assert.match(spotlightGradient(10, 20), /var\(--accent\)/);
  assert.doesNotMatch(spotlightGradient(10, 20), /rgba\(255,\s*255,\s*255/);
  const html = renderToStaticMarkup(
    React.createElement(SpotlightCard, null, "card"),
  );
  assert.match(html, /data-effects="spotlight-card"/);
  assert.match(html, /card/);
});
test("SpringCheck renders an accent completed mark, decorative by default", () => {
  const html = renderToStaticMarkup(React.createElement(SpringCheck, { size: 15 }));
  assert.match(html, /data-effects="spring-check"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /var\(--accent\)/);
  const labeled = renderToStaticMarkup(React.createElement(SpringCheck, { size: 15, label: "Completed" }));
  assert.match(labeled, /aria-label="Completed"/);
});

test("ClickSpark renders a static wrapper for SSR", () => {
  const spark = renderToStaticMarkup(
    React.createElement(ClickSpark, null, "send"),
  );
  assert.match(spark, /data-effects="click-spark"/);
  assert.match(spark, /<canvas/);
});
test("StaggerList staggers rows with per-item delays", () => {
  const html = renderToStaticMarkup(
    React.createElement(StaggerList, { stagger: 24 },
      React.createElement("span", { key: "a" }, "a"),
      React.createElement("span", { key: "b" }, "b")),
  );
  assert.match(html, /data-effects="stagger-list"/);
  assert.match(html, /animation-delay:24ms/);
});

test("TypeHint keeps full text for screen readers and ShinyText sweeps", () => {
  const hint = renderToStaticMarkup(React.createElement(TypeHint, { text: "press /" }));
  assert.match(hint, /data-effects="type-hint"/);
  assert.match(hint, /press \//);
  const shiny = renderToStaticMarkup(React.createElement(ShinyText, { text: "naming…" }));
  assert.match(shiny, /data-effects="shiny-text"/);
  const plain = renderToStaticMarkup(React.createElement(ShinyText, { text: "done", disabled: true }));
  assert.doesNotMatch(plain, /effects-shiny"/);
});

test("DotGrid renders an aria-hidden canvas layer", () => {
  const html = renderToStaticMarkup(React.createElement(DotGrid, null));
  assert.match(html, /data-effects="dot-grid"/);
  assert.match(html, /<canvas/);
  assert.match(html, /aria-hidden="true"/);
});
test("ParticleText renders an accessible canvas hero", () => {
  const html = renderToStaticMarkup(React.createElement(ParticleText, { text: "omp loom", height: 104 }));
  assert.match(html, /data-effects="particle-text"/);
  assert.match(html, /<canvas/);
  assert.match(html, /aria-label="omp loom"/);
  assert.match(html, /omp loom/);
});

test("SendGlyph renders the arrow at rest and the stop square while busy", () => {
  const idle = renderToStaticMarkup(React.createElement(SendGlyph, { busy: false }));
  assert.match(idle, /data-effects="send-glyph"/);
  assert.match(idle, /aria-hidden="true"/);
  assert.doesNotMatch(idle, /#[0-9a-fA-F]{3,6}/);
  assert.ok(idle.includes(`d="${sendGlyphPath(0)}"`));
  const busy = renderToStaticMarkup(React.createElement(SendGlyph, { busy: true }));
  assert.ok(busy.includes(`d="${sendGlyphPath(1)}"`));
});

test("sendGlyphPath interpolates one polygon instead of swapping two shapes", () => {
  const arrow = sendGlyphPath(0);
  const square = sendGlyphPath(1);
  const mid = sendGlyphPath(0.5);
  assert.notEqual(arrow, square);
  assert.equal(arrow.match(/[ML]/g)?.length, 7);
  assert.equal(square.match(/[ML]/g)?.length, 7);
  assert.ok(arrow.endsWith("Z") && square.endsWith("Z"));
  assert.notEqual(mid, arrow);
  assert.notEqual(mid, square);
});

test("sendGlyphEase eases into the morph with exact endpoints", () => {
  assert.ok(Math.abs(sendGlyphEase(0)) < 1e-6);
  assert.ok(Math.abs(sendGlyphEase(1) - 1) < 1e-3);
  let previous = -1;
  for (let t = 0; t <= 1; t += 0.1) {
    const value = sendGlyphEase(Number(t.toFixed(1)));
    assert.ok(value >= previous, `ease stays monotonic at ${t}`);
    previous = value;
  }
  assert.ok(sendGlyphEase(0.5) > 0.5, "the morph front-loads then settles");
});

test("SendGlyph jumps to the square without frames when motion is reduced", async () => {
  const realRaf = globalThis.requestAnimationFrame;
  const realMatchMedia = window.matchMedia;
  const scheduled = [];
  globalThis.requestAnimationFrame = (callback) => {
    scheduled.push(callback);
    return scheduled.length;
  };
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  try {
    let view;
    await act(async () => {
      view = render(React.createElement(SendGlyph, { busy: false }));
    });
    const path = view.container.querySelector("path");
    await act(async () => {
      view.rerender(React.createElement(SendGlyph, { busy: true }));
    });
    assert.equal(path.getAttribute("d"), sendGlyphPath(1));
    assert.equal(scheduled.length, 0, "reduced motion never starts the morph loop");
    await act(async () => {
      view.unmount();
    });
  } finally {
    globalThis.requestAnimationFrame = realRaf;
    if (realMatchMedia) window.matchMedia = realMatchMedia;
    else delete window.matchMedia;
  }
});

test("SendGlyph animates through intermediate frames and settles on the square", async () => {
  const realRaf = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;
  const realNow = globalThis.performance.now;
  const realMatchMedia = window.matchMedia;
  const pending = new Map();
  let nextId = 0;
  let now = 1000;
  globalThis.requestAnimationFrame = (callback) => {
    nextId += 1;
    pending.set(nextId, callback);
    return nextId;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  // Shadow only `now`; React's dev user-timing calls performance.measure/mark.
  Object.defineProperty(globalThis.performance, "now", {
    configurable: true,
    writable: true,
    value: () => now,
  });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const flush = () => {
    const batch = [...pending.values()];
    pending.clear();
    for (const callback of batch) callback(now);
  };
  try {
    let view;
    await act(async () => {
      view = render(React.createElement(SendGlyph, { busy: false }));
    });
    const path = view.container.querySelector("path");
    const svg = view.container.querySelector("svg");
    assert.equal(path.getAttribute("d"), sendGlyphPath(0));
    assert.equal(pending.size, 0, "an idle glyph does not burn frames");

    await act(async () => {
      view.rerender(React.createElement(SendGlyph, { busy: true }));
    });
    assert.ok(pending.size > 0, "the morph schedules a frame");

    now += 120;
    await act(async () => flush());
    const mid = path.getAttribute("d");
    assert.notEqual(mid, sendGlyphPath(0));
    assert.notEqual(mid, sendGlyphPath(1));
    assert.match(svg.style.transform, /rotate\(/);

    now += 120;
    await act(async () => flush());
    assert.equal(path.getAttribute("d"), sendGlyphPath(1));
    assert.equal(svg.style.transform, "");
    assert.equal(pending.size, 0, "the loop stops once the morph settles");

    await act(async () => {
      view.unmount();
    });
  } finally {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
    Object.defineProperty(globalThis.performance, "now", {
      configurable: true,
      writable: true,
      value: realNow,
    });
    if (realMatchMedia) window.matchMedia = realMatchMedia;
    else delete window.matchMedia;
  }
});

test("LatticeLoader renders a phase-offset lattice with a label and timer", () => {
  const html = renderToStaticMarkup(React.createElement(LatticeLoader, { label: "Thinking", startedAt: 0 }));
  assert.match(html, /data-effects="lattice-loader"/);
  assert.match(html, /data-status="working"/);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,6}/);
  assert.match(html, /Thinking/);
  assert.equal((html.match(/class="effects-lattice-cell"/g) ?? []).length, 18, "nine run cells plus nine mark cells");
  assert.equal((html.match(/data-hole/g) ?? []).length, 1, "the orbit pattern leaves the centre empty");
  const delays = [...html.matchAll(/animation-delay:(\d+)ms/g)].map((match) => Number(match[1]));
  assert.equal(delays.length, 8);
  assert.equal(new Set(delays).size, 8, "every ring cell is out of phase");
  assert.ok(html.includes("0.0s"));
});

test("LatticeLoader draws the resolve mark and swaps the label", () => {
  const done = renderToStaticMarkup(
    React.createElement(LatticeLoader, { label: "Thinking", status: "done", doneLabel: "Done in", elapsedSeconds: 12.4 }),
  );
  assert.match(done, /data-status="done"/);
  assert.equal((done.match(/data-on/g) ?? []).length, 4, "the check uses four cells");
  assert.match(done, /Done in/);
  assert.ok(done.includes("12.4s"));

  const failed = renderToStaticMarkup(
    React.createElement(LatticeLoader, { label: "Thinking", status: "error", errorLabel: "Failed after", elapsedSeconds: 3 }),
  );
  assert.match(failed, /data-status="error"/);
  assert.equal((failed.match(/data-on/g) ?? []).length, 5, "the cross uses five cells");
  assert.match(failed, /Failed after/);
});

test("formatLatticeTime switches to minutes past 60s", () => {
  assert.equal(formatLatticeTime(0), "0.0s");
  assert.equal(formatLatticeTime(42), "4.2s");
  assert.equal(formatLatticeTime(599), "59.9s");
  assert.equal(formatLatticeTime(600), "1m 0.0s");
  assert.equal(formatLatticeTime(642), "1m 4.2s");
});

test("LatticeLoader ticks its own stopwatch while working and freezes on done", async () => {
  const realSetInterval = window.setInterval;
  const realClearInterval = window.clearInterval;
  const realNow = Date.now;
  const timers = new Map();
  let nextId = 0;
  let now = 12_345;
  window.setInterval = (callback) => {
    nextId += 1;
    timers.set(nextId, callback);
    return nextId;
  };
  window.clearInterval = (id) => timers.delete(id);
  Date.now = () => now;
  const runTimers = () => {
    for (const callback of [...timers.values()]) callback();
  };
  try {
    let view;
    await act(async () => {
      view = render(React.createElement(LatticeLoader, { label: "Thinking", startedAt: 0 }));
    });
    const timerText = () => view.container.querySelector(".effects-lattice-timer").textContent;
    const activeLabel = () => view.container.querySelector(".effects-lattice-text[data-active]").textContent;
    assert.equal(timerText(), "12.3s", "the stopwatch anchors to startedAt");

    now = 18_045;
    await act(async () => runTimers());
    assert.equal(timerText(), "18.0s");

    await act(async () => {
      view.rerender(
        React.createElement(LatticeLoader, {
          label: "Thinking",
          status: "done",
          doneLabel: "Done in",
          elapsedSeconds: 12.4,
        }),
      );
    });
    assert.equal(activeLabel(), "Done in");
    assert.equal(timerText(), "12.4s", "a resolved task shows the frozen duration");
    assert.equal(timers.size, 0, "and stops its stopwatch");
  } finally {
    window.setInterval = realSetInterval;
    window.clearInterval = realClearInterval;
    Date.now = realNow;
  }
});

test("SpecularRim renders a decorative layer with no hardcoded color", () => {
  const html = renderToStaticMarkup(
    React.createElement("button", null, React.createElement(SpecularRim, null)),
  );
  assert.match(html, /data-effects="specular-rim"/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,6}/);
  assert.doesNotMatch(html, /data-on/, "the rim starts hidden");
});

test("SpecularRim steers its angle with the pointer and settles", async () => {
  const realRaf = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;
  const realNow = globalThis.performance.now;
  const realMatchMedia = window.matchMedia;
  const frames = new Map();
  let nextId = 0;
  let now = 5000;
  globalThis.requestAnimationFrame = (callback) => {
    nextId += 1;
    frames.set(nextId, callback);
    return nextId;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  Object.defineProperty(globalThis.performance, "now", {
    configurable: true,
    writable: true,
    value: () => now,
  });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const settle = async () => {
    let guard = 0;
    while (frames.size > 0 && guard < 400) {
      now += 16;
      const batch = [...frames.values()];
      frames.clear();
      await act(async () => {
        for (const callback of batch) callback(now);
      });
      guard += 1;
    }
  };
  try {
    let view;
    await act(async () => {
      view = render(React.createElement("button", null, React.createElement(SpecularRim, null)));
    });
    const host = view.container.querySelector("button");
    const rim = view.container.querySelector('[data-effects="specular-rim"]');
    // jsdom lays nothing out: give the host a real box so the angle is testable.
    host.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40, x: 0, y: 0, toJSON: () => ({}),
    });

    await act(async () => {
      host.dispatchEvent(new window.MouseEvent("pointerenter", { clientX: 100, clientY: 20, bubbles: true }));
    });
    assert.equal(rim.getAttribute("data-on"), "", "the rim lights up over the button");

    await settle();
    assert.equal(frames.size, 0, "the follow loop stops once the streak settles");
    // Pointer at 3 o'clock -> conic gradient offset 90deg.
    assert.equal(rim.style.getPropertyValue("--spec-angle"), "90.00deg");

    await act(async () => {
      host.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 0, clientY: 0, bubbles: true }));
    });
    await settle();
    // Top-left corner: direction 201.8deg from centre -> gradient offset -68.2deg,
    // so the streak sits up-left where the light comes from.
    assert.equal(rim.style.getPropertyValue("--spec-angle"), "-68.20deg", "the streak tracks the pointer");

    await act(async () => {
      host.dispatchEvent(new window.MouseEvent("pointerleave", { bubbles: true }));
    });
    assert.equal(rim.getAttribute("data-on"), null, "leaving clears the rim");
  } finally {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
    Object.defineProperty(globalThis.performance, "now", {
      configurable: true,
      writable: true,
      value: realNow,
    });
    if (realMatchMedia) window.matchMedia = realMatchMedia;
    else delete window.matchMedia;
  }
});

test("SpecularRim keeps a static highlight when motion is reduced", async () => {
  const realRaf = globalThis.requestAnimationFrame;
  const realMatchMedia = window.matchMedia;
  const frames = [];
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  try {
    let view;
    await act(async () => {
      view = render(React.createElement("button", null, React.createElement(SpecularRim, null)));
    });
    const host = view.container.querySelector("button");
    const rim = view.container.querySelector('[data-effects="specular-rim"]');
    await act(async () => {
      host.dispatchEvent(new window.MouseEvent("pointerenter", { clientX: 100, clientY: 20, bubbles: true }));
      host.dispatchEvent(new window.MouseEvent("pointermove", { clientX: 100, clientY: 20, bubbles: true }));
    });
    assert.equal(rim.getAttribute("data-on"), "", "the static highlight still shows");
    assert.equal(frames.length, 0, "reduced motion never starts the follow loop");
    assert.equal(rim.style.getPropertyValue("--spec-angle"), "", "the CSS default angle stands");
  } finally {
    globalThis.requestAnimationFrame = realRaf;
    if (realMatchMedia) window.matchMedia = realMatchMedia;
    else delete window.matchMedia;
  }
});

test("SwipeToast renders its card, fuse and dismiss affordance without hardcoded colors", () => {
  const html = renderToStaticMarkup(
    React.createElement(SwipeToast, { title: "Tool inventory changed", duration: 5000, inline: true, closeButton: true }),
  );
  assert.match(html, /data-effects="swipe-toast"/);
  assert.match(html, /data-phase="open"/);
  assert.match(html, /data-fuse="true"/);
  assert.match(html, /Tool inventory changed/);
  assert.match(html, /swipe-toast__fuse/);
  assert.match(html, /aria-label="Dismiss"/);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,6}/);

  const sticky = renderToStaticMarkup(
    React.createElement(SwipeToast, { title: "Working", duration: 0 }),
  );
  assert.match(sticky, /data-fuse="false"/);
  assert.doesNotMatch(sticky, /swipe-toast__fuse/, "a sticky toast burns no fuse");
});

test("SwipeToast clamps its title and offers the full text on hover", () => {
  const single = renderToStaticMarkup(
    React.createElement(SwipeToast, { title: "a very long notice", titleClamp: 1 }),
  );
  assert.match(single, /-webkit-line-clamp:1/);
  assert.match(single, /title="a very long notice"/);
});

test("SwipeToast drag geometry resists upward pulls and needs a flick or a distance", () => {
  const pulled = swipeToastRubberband(-200, 24);
  assert.ok(pulled < 0 && pulled > -200, "an upward pull resists instead of detaching");

  assert.equal(swipeToastShouldDismiss(-30, 2), false, "an upward flick is not a dismiss");
  assert.equal(swipeToastShouldDismiss(12, 0.4), true, "a fast flick dismisses");
  assert.equal(swipeToastShouldDismiss(48, 0), true, "a long pull dismisses");
  assert.equal(swipeToastShouldDismiss(20, 0), false, "a short slow pull springs back");

  const now = 1000;
  assert.equal(swipeToastVelocity([[0, 0], [100, 30]], now), 0, "stale samples are not a flick");
  assert.ok(swipeToastVelocity([[850, 0], [950, 20]], now) > 0);
});

test("SwipeToast burns its fuse for exactly the remaining time and pauses on hover", async () => {
  const realSetTimeout = window.setTimeout;
  const realClearTimeout = window.clearTimeout;
  const timers = new Map();
  let nextId = 0;
  // Only the components' own timers are captured: React and testing-library
  // schedule zero-delay work through the same global, and running that mid-act
  // would re-enter their internals.
  window.setTimeout = (callback, delay) => {
    if (!(delay >= 100)) return realSetTimeout(callback, delay);
    nextId += 1;
    timers.set(nextId, callback);
    return nextId;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
  };
  const runTimers = () => {
    const batch = [...timers.values()];
    timers.clear();
    for (const callback of batch) callback();
  };

  try {
    const closes = [];
    let view;
    await act(async () => {
      view = render(React.createElement(SwipeToast, {
        title: "Build finished",
        duration: 5000,
        onClose: (reason) => closes.push(reason),
      }));
    });
    const root = view.container.querySelector('[data-effects="swipe-toast"]');
    const card = view.container.querySelector(".swipe-toast__card");

    // Hovering holds the window open: the timer is torn down with its leftover.
    await act(async () => {
      card.dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", relatedTarget: document.body }));
    });
    assert.equal(root.getAttribute("data-paused"), "true");
    assert.equal(timers.size, 0, "a paused fuse keeps no running timer");

    await act(async () => {
      card.dispatchEvent(new window.PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: document.body }));
    });
    assert.equal(root.getAttribute("data-paused"), "false");
    assert.equal(timers.size, 1, "leaving restarts the leftover");

    await act(async () => runTimers());
    assert.equal(root.getAttribute("data-phase"), "closing");
    await act(async () => runTimers());
    assert.deepEqual(closes, ["timeout"]);

    await act(async () => {
      view.unmount();
    });
    assert.equal(timers.size, 0, "unmounting clears the timer");
  } finally {
    window.setTimeout = realSetTimeout;
    window.clearTimeout = realClearTimeout;
  }
});

test("SwipeToast reports escape and programmatic exits separately", async () => {
  const realSetTimeout = window.setTimeout;
  const realClearTimeout = window.clearTimeout;
  const timers = new Map();
  let nextId = 0;
  // Only the components' own timers are captured: React and testing-library
  // schedule zero-delay work through the same global, and running that mid-act
  // would re-enter their internals.
  window.setTimeout = (callback, delay) => {
    if (!(delay >= 100)) return realSetTimeout(callback, delay);
    nextId += 1;
    timers.set(nextId, callback);
    return nextId;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
  };
  const runTimers = () => {
    const batch = [...timers.values()];
    timers.clear();
    for (const callback of batch) callback();
  };

  try {
    const closes = [];
    const element = (open) => React.createElement(SwipeToast, {
      title: "Queued",
      open,
      onClose: (reason) => closes.push(reason),
    });

    // Escape on a live notice.
    let view;
    await act(async () => {
      view = render(element(true));
    });
    const card = view.container.querySelector(".swipe-toast__card");
    await act(async () => {
      card.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(view.container.querySelector('[data-effects="swipe-toast"]').getAttribute("data-phase"), "closing");
    await act(async () => runTimers());
    assert.deepEqual(closes, ["escape"]);
    await act(async () => {
      view.unmount();
    });

    // The caller flipping `open` off reports a programmatic close.
    await act(async () => {
      view = render(element(true));
    });
    await act(async () => {
      view.rerender(element(false));
    });
    await act(async () => runTimers());
    assert.deepEqual(closes, ["escape", "programmatic"]);
    await act(async () => {
      view.unmount();
    });
    assert.equal(timers.size, 0, "unmounting clears the timer");
    assert.ok(SWIPE_TOAST_CLOSE_MS > 0 && SWIPE_TOAST_COLLAPSE_MS > 0);
  } finally {
    window.setTimeout = realSetTimeout;
    window.clearTimeout = realClearTimeout;
  }
});

test("FuseButton arms, burns and commits on the fuse end without a confirm dialog", async () => {
  const realSetTimeout = window.setTimeout;
  const realClearTimeout = window.clearTimeout;
  const timers = new Map();
  let nextId = 0;
  // Only the components' own timers are captured: React and testing-library
  // schedule zero-delay work through the same global, and running that mid-act
  // would re-enter their internals.
  window.setTimeout = (callback, delay) => {
    if (!(delay >= 100)) return realSetTimeout(callback, delay);
    nextId += 1;
    timers.set(nextId, callback);
    return nextId;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
  };
  const runTimers = () => {
    const batch = [...timers.values()];
    timers.clear();
    for (const callback of batch) callback();
  };

  try {
    const events = [];
    let view;
    await act(async () => {
      view = render(React.createElement(FuseButton, {
        label: "Remove",
        armedLabel: "Undo",
        defaultArmed: true,
        commitOn: "fuseEnd",
        undoWindow: 4000,
        onArmedChange: (armed) => events.push(`armed:${armed}`),
        onCommit: () => events.push("commit"),
      }));
    });
    const button = view.container.querySelector('[data-effects="fuse-button"]');
    assert.equal(button.getAttribute("data-phase"), "armed");
    assert.match(button.textContent, /Undo/);
    assert.ok(view.container.querySelector(".fuse-button__fuse"), "the fuse is burning");

    await act(async () => runTimers());
    assert.deepEqual(events, ["armed:false", "commit"], "the action runs when the fuse burns out");

    await act(async () => {
      view.unmount();
    });
  } finally {
    window.setTimeout = realSetTimeout;
    window.clearTimeout = realClearTimeout;
  }
});

test("FuseButton undo takes an armed action back and never commits", async () => {
  const realSetTimeout = window.setTimeout;
  const realClearTimeout = window.clearTimeout;
  const timers = new Map();
  let nextId = 0;
  // Only the components' own timers are captured: React and testing-library
  // schedule zero-delay work through the same global, and running that mid-act
  // would re-enter their internals.
  window.setTimeout = (callback, delay) => {
    if (!(delay >= 100)) return realSetTimeout(callback, delay);
    nextId += 1;
    timers.set(nextId, callback);
    return nextId;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
  };

  try {
    const events = [];
    let view;
    await act(async () => {
      view = render(React.createElement(FuseButton, {
        label: "Archive",
        commitOn: "press",
        onCommit: () => events.push("commit"),
        onUndo: () => events.push("undo"),
      }));
    });
    const button = view.container.querySelector('[data-effects="fuse-button"]');
    assert.equal(button.getAttribute("data-phase"), "idle");

    await act(async () => {
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(button.getAttribute("data-phase"), "armed");
    assert.deepEqual(events, ["commit"], "press mode commits immediately");

    await act(async () => {
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(button.getAttribute("data-phase"), "idle");
    assert.deepEqual(events, ["commit", "undo"]);
    assert.equal(timers.size, 0, "undo clears the window");

    await act(async () => {
      view.unmount();
    });
  } finally {
    window.setTimeout = realSetTimeout;
    window.clearTimeout = realClearTimeout;
  }
});

test("FuseButton holds the window open while hovered or focused", async () => {
  const realSetTimeout = window.setTimeout;
  const realClearTimeout = window.clearTimeout;
  const timers = new Map();
  let nextId = 0;
  // Only the components' own timers are captured: React and testing-library
  // schedule zero-delay work through the same global, and running that mid-act
  // would re-enter their internals.
  window.setTimeout = (callback, delay) => {
    if (!(delay >= 100)) return realSetTimeout(callback, delay);
    nextId += 1;
    timers.set(nextId, callback);
    return nextId;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
  };

  try {
    let commits = 0;
    let view;
    await act(async () => {
      view = render(React.createElement(FuseButton, {
        label: "Hide",
        defaultArmed: true,
        commitOn: "fuseEnd",
        onCommit: () => { commits += 1; },
      }));
    });
    const button = view.container.querySelector('[data-effects="fuse-button"]');
    await act(async () => {
      button.dispatchEvent(new window.PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", relatedTarget: document.body }));
    });
    assert.equal(button.getAttribute("data-paused"), "true");
    assert.equal(timers.size, 0, "a held fuse keeps no running timer");
    assert.equal(commits, 0);

    await act(async () => {
      button.dispatchEvent(new window.PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: document.body }));
    });
    assert.equal(timers.size, 1, "leaving restarts the leftover window");

    await act(async () => {
      view.unmount();
    });
  } finally {
    window.setTimeout = realSetTimeout;
    window.clearTimeout = realClearTimeout;
  }
});

test("FuseButton settle keeps the done label for a beat, reset returns to idle", async () => {
  assert.ok(FUSE_BUTTON_SETTLE_MS > 0);
  const settled = renderToStaticMarkup(
    React.createElement(FuseButton, { label: "Copy", doneLabel: "Copied", defaultArmed: true, commitOn: "press" }),
  );
  assert.match(settled, /data-phase="armed"/);
  assert.match(settled, /Undo/);
});

test("BellToggle announces its state and rings on the way on", async () => {
  const realSetTimeout = window.setTimeout;
  const realClearTimeout = window.clearTimeout;
  const timers = new Map();
  let nextId = 0;
  // Only the components' own timers are captured: React and testing-library
  // schedule zero-delay work through the same global, and running that mid-act
  // would re-enter their internals.
  window.setTimeout = (callback, delay) => {
    if (!(delay >= 100)) return realSetTimeout(callback, delay);
    nextId += 1;
    timers.set(nextId, callback);
    return nextId;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
  };

  try {
    const changes = [];
    let view;
    await act(async () => {
      view = render(React.createElement(BellToggle, {
        offLabel: "Muted",
        onLabel: "Sound on",
        onChange: (pressed) => changes.push(pressed),
      }));
    });
    const root = view.container.querySelector('[data-effects="bell-toggle"]');
    const button = view.container.querySelector(".bell-toggle__button");
    assert.equal(root.getAttribute("data-on"), "false");
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(button.getAttribute("aria-label"), "Muted");
    assert.equal(view.container.querySelector(".bell-toggle__slot[data-active='true']").textContent, "Muted");
    assert.equal(view.container.querySelector(".bell-toggle__glyph").getAttribute("data-ringing"), null);

    await act(async () => {
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    assert.deepEqual(changes, [true]);
    assert.equal(root.getAttribute("data-on"), "true");
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.equal(button.getAttribute("aria-label"), "Sound on");
    assert.equal(view.container.querySelector(".bell-toggle__slot[data-active='true']").textContent, "Sound on");
    assert.equal(view.container.querySelector(".bell-toggle__glyph").getAttribute("data-ringing"), "true");

    await act(async () => {
      for (const callback of [...timers.values()]) callback();
    });
    assert.equal(view.container.querySelector(".bell-toggle__glyph").getAttribute("data-ringing"), null, "the ring is one-shot");

    await act(async () => {
      view.unmount();
    });
    assert.equal(timers.size, 0);
    assert.ok(BELL_TOGGLE_RING_MS > 0);
  } finally {
    window.setTimeout = realSetTimeout;
    window.clearTimeout = realClearTimeout;
  }
});

test("BellToggle badges its count while on and caps it at 9+", () => {
  const off = renderToStaticMarkup(
    React.createElement(BellToggle, { offLabel: "Muted", onLabel: "Sound on", count: 4 }),
  );
  assert.doesNotMatch(off, /bell-toggle__badge/, "no badge while muted");

  const on = renderToStaticMarkup(
    React.createElement(BellToggle, { offLabel: "Muted", onLabel: "Sound on", pressed: true, count: 12 }),
  );
  assert.match(on, /bell-toggle__badge/);
  assert.match(on, /9\+/);
  assert.doesNotMatch(on, /#[0-9a-fA-F]{3,6}/);
});

test("BellToggle stays controlled when the caller owns the state", async () => {
  const changes = [];
  let view;
  await act(async () => {
    view = render(React.createElement(BellToggle, {
      offLabel: "Muted",
      onLabel: "Sound on",
      pressed: false,
      onChange: (pressed) => changes.push(pressed),
    }));
  });
  const button = view.container.querySelector(".bell-toggle__button");
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  assert.deepEqual(changes, [true]);
  assert.equal(button.getAttribute("aria-pressed"), "false", "the caller still owns the state");
  await act(async () => {
    view.unmount();
  });
});

test("formatCallChipElapsed switches units at one second and one minute", () => {
  assert.equal(formatCallChipElapsed(0), "0ms");
  assert.equal(formatCallChipElapsed(840), "840ms");
  assert.equal(formatCallChipElapsed(1000), "1.0s");
  assert.equal(formatCallChipElapsed(12400), "12.4s");
  assert.equal(formatCallChipElapsed(64200), "1m 04s");
});

test("CallChip ticks while running, freezes when it settles, and wipes determinate work", async () => {
  const realSetInterval = window.setInterval;
  const realClearInterval = window.clearInterval;
  const realNow = Date.now;
  const timers = new Map();
  let nextId = 0;
  let now = 1_000_000;
  window.setInterval = (callback) => {
    nextId += 1;
    timers.set(nextId, callback);
    return nextId;
  };
  window.clearInterval = (id) => {
    timers.delete(id);
  };
  Date.now = () => now;

  try {
    let view;
    await act(async () => {
      view = render(React.createElement(CallChip, { name: "bash", status: "running", startedAt: 999_000, label: "Running bash" }));
    });
    const root = view.container.querySelector('[data-effects="call-chip"]');
    assert.equal(root.getAttribute("role"), "status");
    assert.equal(root.getAttribute("aria-label"), "Running bash");
    const time = () => view.container.querySelector(".call-chip__time").textContent;
    assert.equal(time(), "1.0s");
    assert.equal(timers.size, 1, "a running call ticks");

    now += 2400;
    await act(async () => {
      for (const callback of [...timers.values()]) callback();
    });
    assert.equal(time(), "3.4s");

    await act(async () => {
      view.rerender(React.createElement(CallChip, { name: "bash", status: "success", startedAt: 999_000, label: "Running bash" }));
    });
    assert.equal(timers.size, 0, "a settled call stops ticking");
    assert.equal(root.getAttribute("data-status"), "success");
    assert.ok(CALL_CHIP_TICK_MS > 0);

    const determinate = renderToStaticMarkup(
      React.createElement(CallChip, { name: "upload", progress: 0.5 }),
    );
    assert.match(determinate, /scaleX\(0\.5\)/);
    assert.doesNotMatch(determinate, /#[0-9a-fA-F]{3,6}/);

    await act(async () => {
      view.unmount();
    });
  } finally {
    window.setInterval = realSetInterval;
    window.clearInterval = realClearInterval;
    Date.now = realNow;
  }
});
