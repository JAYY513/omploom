import "../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import React from "react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react/pure.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { ThinkingEffortSlider } = await jiti.import("./ChatInput-thinking-slider.tsx");
const { ChatInput } = await jiti.import("./ChatInput.tsx");
const { clearDraft } = await jiti.import("@/lib/draft-store");

beforeEach(() => {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  cleanup();
  clearDraft("new:unassigned");
  localStorage.clear();
  delete window.matchMedia;
});

const LEVELS = ["auto", "off", "low", "medium", "high"];

function renderSlider(props = {}) {
  const calls = [];
  const view = render(React.createElement(ThinkingEffortSlider, {
    levels: LEVELS,
    value: "auto",
    displayLabelFor: (lvl) => lvl,
    maxed: false,
    onChange: (lvl) => calls.push(lvl),
    ...props,
  }));
  return { calls, view };
}

function mockTrackRect(track, { left = 0, width = 200 } = {}) {
  track.getBoundingClientRect = () => ({
    left, width, top: 0, height: 22, right: left + width, bottom: 22, x: left, y: 0, toJSON() {},
  });
}

test("renders the PromptBar effort structure with live level", () => {
  const { view } = renderSlider({ value: "medium" });
  const track = screen.getByRole("slider");
  assert.equal(track.getAttribute("aria-valuenow"), "3");
  assert.equal(track.getAttribute("aria-valuetext"), "medium");
  assert.equal(view.container.querySelector(".picker-effort-level")?.textContent, "medium");
  assert.equal(view.container.querySelectorAll(".picker-effort-dot").length, LEVELS.length);
  assert.ok(track.style.getPropertyValue("--pb-effort-x"));
  assert.ok(track.style.getPropertyValue("--pb-effort-fill"));
});

test("arrow keys step one level and commit", () => {
  const { calls } = renderSlider({ value: "low" });
  fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
  assert.deepEqual(calls, ["medium"]);
});

test("Home jumps to the first stop", () => {
  const { calls } = renderSlider({ value: "medium" });
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
  assert.deepEqual(calls, ["auto"]);
});

test("drag previews then commits once on release", () => {
  const { calls } = renderSlider({ value: "auto" });
  const track = screen.getByRole("slider");
  mockTrackRect(track);
  fireEvent.pointerDown(track, { button: 0, clientX: 13 });
  fireEvent.pointerMove(track, { clientX: 187 });
  assert.deepEqual(calls, []);
  assert.equal(track.getAttribute("aria-valuenow"), "4");
  fireEvent.pointerUp(track, { clientX: 187 });
  assert.deepEqual(calls, ["high"]);
});

test("drag ending on the current level commits nothing", () => {
  const { calls } = renderSlider({ value: "auto" });
  const track = screen.getByRole("slider");
  mockTrackRect(track);
  fireEvent.pointerDown(track, { button: 0, clientX: 13 });
  fireEvent.pointerUp(track, { clientX: 15 });
  assert.deepEqual(calls, []);
});

test("maxed stop fills the track and flags the view", () => {
  const { view } = renderSlider({ value: "high", maxed: true });
  assert.equal(view.container.querySelector(".picker-effort")?.getAttribute("data-max"), "true");
  assert.equal(screen.getByRole("slider").style.getPropertyValue("--pb-effort-fill"), "100%");
});

function openThinkingMenu(props = {}) {
  const picked = [];
  const view = render(React.createElement(ChatInput, {
    onSend() {},
    onAbort() {},
    isStreaming: false,
    thinkingLevel: "low",
    availableThinkingLevels: ["off", "low", "medium", "high"],
    onThinkingLevelChange: (lvl) => picked.push(lvl),
    ...props,
  }));
  const trigger = view.container.querySelector(".composer-thinking-control > button");
  assert.ok(trigger);
  fireEvent.click(trigger);
  return { picked, view };
}

test("thinking menu defaults to the slider; the list needs a click", () => {
  const { view } = openThinkingMenu();
  assert.ok(screen.getByRole("slider"));
  assert.equal(view.container.querySelectorAll('[role="menuitemradio"]').length, 0);
  fireEvent.click(view.container.querySelector(".picker-effort-more"));
  // Traditional click path intact: auto + the four model levels.
  assert.equal(screen.getAllByRole("menuitemradio").length, 5);
  fireEvent.click(view.container.querySelector(".picker-thinking-back"));
  assert.ok(screen.getByRole("slider"));
  assert.equal(view.container.querySelectorAll('[role="menuitemradio"]').length, 0);
});

test("slider commit keeps the menu open for further drags", () => {
  const { picked, view } = openThinkingMenu();
  fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
  assert.deepEqual(picked, ["medium"]);
  assert.ok(screen.getByRole("slider", { hidden: false }));
  assert.equal(view.container.querySelectorAll('[role="menuitemradio"]').length, 0);
});

test("Escape on the slider closes the menu", () => {
  const { view } = openThinkingMenu();
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Escape" });
  assert.equal(view.container.querySelectorAll('[role="slider"]').length, 0);
});

test("trigger carries the max state on the strongest stop", () => {
  const top = openThinkingMenu({ thinkingLevel: "high" });
  assert.equal(top.view.container.querySelector(".composer-thinking-control")?.getAttribute("data-max"), "true");
  top.view.unmount();
  cleanup();
  const mid = openThinkingMenu({ thinkingLevel: "low" });
  assert.equal(mid.view.container.querySelector(".composer-thinking-control")?.getAttribute("data-max"), null);
});

test("composer shell glows with sparks on the strongest stop", () => {
  const { view } = openThinkingMenu({ thinkingLevel: "high" });
  const shell = view.container.querySelector(".chat-input-shell");
  assert.equal(shell?.getAttribute("data-max"), "true");
  assert.ok(shell?.querySelector("canvas.chat-input-max-sparks"));
});

test("composer shell has no effect below the strongest stop", () => {
  const { view } = openThinkingMenu({ thinkingLevel: "low" });
  const shell = view.container.querySelector(".chat-input-shell");
  assert.equal(shell?.getAttribute("data-max"), null);
  assert.equal(shell?.querySelector("canvas.chat-input-max-sparks"), null);
});

test("no sparks canvas under reduced motion", () => {
  const mq = window.matchMedia;
  window.matchMedia = (query) => ({
    matches: String(query).includes("reduce"),
    media: String(query),
    addEventListener() {},
    removeEventListener() {},
  });
  try {
    const { view } = openThinkingMenu({ thinkingLevel: "high" });
    assert.equal(view.container.querySelector(".chat-input-shell")?.getAttribute("data-max"), "true");
    assert.equal(view.container.querySelector("canvas.chat-input-max-sparks"), null);
  } finally {
    window.matchMedia = mq;
  }
});
