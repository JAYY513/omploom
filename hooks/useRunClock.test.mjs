import "../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { act, cleanup, renderHook } from "@testing-library/react/pure.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { useRunClock } = await jiti.import("./useRunClock.ts");

afterEach(() => {
  cleanup();
});

/** Deterministic clock + timer harness: no real waiting, no real time. */
function harness({ start = 1_000_000, linger = 2500 } = {}) {
  const realSetTimeout = window.setTimeout;
  const realClearTimeout = window.clearTimeout;
  const realNow = Date.now;
  const timers = new Map();
  let nextId = 0;
  let now = start;
  window.setTimeout = (callback) => {
    nextId += 1;
    timers.set(nextId, callback);
    return nextId;
  };
  window.clearTimeout = (id) => timers.delete(id);
  Date.now = () => now;
  return {
    linger,
    advance(ms) {
      now += ms;
    },
    fireTimers() {
      for (const callback of [...timers.values()]) callback();
      timers.clear();
    },
    pendingTimers: () => timers.size,
    restore() {
      window.setTimeout = realSetTimeout;
      window.clearTimeout = realClearTimeout;
      Date.now = realNow;
    },
  };
}

test("anchors to the turn's start and reports the finished duration", async () => {
  const clock = harness({ start: 1_000_000 });
  try {
    const view = renderHook(({ running }) => useRunClock(running, clock.linger), {
      initialProps: { running: false },
    });
    assert.equal(view.result.current.startedAt, null);
    assert.equal(view.result.current.finishedSeconds, null);

    await act(async () => {
      view.rerender({ running: true });
    });
    const anchor = view.result.current.startedAt;
    assert.equal(anchor, 1_000_000);

    // Phase churn must not move the anchor, so the stopwatch never resets.
    clock.advance(4200);
    await act(async () => {
      view.rerender({ running: true });
    });
    assert.equal(view.result.current.startedAt, anchor);

    clock.advance(800);
    await act(async () => {
      view.rerender({ running: false });
    });
    assert.equal(view.result.current.startedAt, null);
    assert.equal(view.result.current.finishedSeconds, 5);

    await act(async () => {
      clock.fireTimers();
    });
    assert.equal(view.result.current.finishedSeconds, null, "the done beat clears after its linger");
  } finally {
    clock.restore();
  }
});

test("a new turn during the linger cancels the pending clear", async () => {
  const clock = harness();
  try {
    const view = renderHook(({ running }) => useRunClock(running, clock.linger), {
      initialProps: { running: false },
    });
    await act(async () => {
      view.rerender({ running: true });
    });
    clock.advance(1500);
    await act(async () => {
      view.rerender({ running: false });
    });
    assert.equal(view.result.current.finishedSeconds, 1.5);
    assert.equal(clock.pendingTimers(), 1);

    await act(async () => {
      view.rerender({ running: true });
    });
    assert.equal(view.result.current.finishedSeconds, null);
    assert.equal(clock.pendingTimers(), 0, "the linger timer is cancelled by the next turn");
    assert.notEqual(view.result.current.startedAt, null);
  } finally {
    clock.restore();
  }
});

test("an aborted turn reports no duration", async () => {
  const clock = harness();
  try {
    const view = renderHook(({ running }) => useRunClock(running, clock.linger), {
      initialProps: { running: false },
    });
    await act(async () => {
      view.rerender({ running: true });
    });
    clock.advance(3000);
    await act(async () => {
      view.result.current.markAborted();
      view.rerender({ running: false });
    });
    assert.equal(view.result.current.finishedSeconds, null, "aborting is not a completion");
    assert.equal(view.result.current.startedAt, null);
    assert.equal(clock.pendingTimers(), 0);

    // The flag is one-shot: the next turn reports normally.
    await act(async () => {
      view.rerender({ running: true });
    });
    clock.advance(2000);
    await act(async () => {
      view.rerender({ running: false });
    });
    assert.equal(view.result.current.finishedSeconds, 2);
  } finally {
    clock.restore();
  }
});
