import "../../tests/setup-dom.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react/pure.js";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { GlideSelect } = await jiti.import("./glide-select.tsx");

function renderSelect(props = {}) {
  const calls = [];
  const view = render(React.createElement(GlideSelect, {
    value: "b",
    onChange: (v) => calls.push(v),
    options: [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
      { value: "c", label: "Gamma", disabled: true },
    ],
    ...props,
  }));
  return { calls, view };
}

test("closed trigger shows the selected label as a combobox", () => {
  const { view } = renderSelect();
  try {
    const trigger = screen.getByRole("combobox");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.match(trigger.textContent ?? "", /Beta/);
    assert.equal(document.querySelectorAll('[role="listbox"]').length, 0);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("placeholder shows dim when nothing matches", () => {
  const { view } = renderSelect({ value: "", placeholder: "Pick one" });
  try {
    assert.match(screen.getByRole("combobox").textContent ?? "", /Pick one/);
    assert.ok(document.querySelector(".glide-select__label")?.hasAttribute("data-empty"));
  } finally {
    view.unmount();
    cleanup();
  }
});

test("click opens the portal menu and picks an option", () => {
  const { calls, view } = renderSelect();
  try {
    fireEvent.click(screen.getByRole("combobox"));
    assert.equal(document.querySelectorAll('[role="option"]').length, 3);
    fireEvent.click(screen.getByText("Alpha"));
    assert.deepEqual(calls, ["a"]);
    assert.equal(document.querySelectorAll('[role="listbox"]').length, 0);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("disabled options never commit", () => {
  const { calls, view } = renderSelect();
  try {
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("Gamma"));
    assert.deepEqual(calls, []);
    assert.equal(document.querySelectorAll('[role="option"]').length, 3);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("keyboard opens, arrows skip disabled rows, Enter commits", () => {
  const { calls, view } = renderSelect({ value: "a" });
  try {
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "Enter" });
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    assert.equal(trigger.getAttribute("aria-activedescendant")?.endsWith("-1"), true);
    fireEvent.keyDown(trigger, { key: "Enter" });
    assert.deepEqual(calls, ["b"]);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("arrow wraps past disabled rows", () => {
  const { view } = renderSelect({ value: "b" });
  try {
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    // Gamma (index 2) is disabled, so focus wraps back to Alpha.
    assert.equal(trigger.getAttribute("aria-activedescendant")?.endsWith("-0"), true);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("Escape closes the menu", () => {
  const { view } = renderSelect();
  try {
    fireEvent.click(screen.getByRole("combobox"));
    assert.equal(document.querySelectorAll('[role="listbox"]').length, 1);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    assert.equal(document.querySelectorAll('[role="listbox"]').length, 0);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("outside pointer closes with a pop", async () => {
  const { view } = renderSelect();
  try {
    fireEvent.click(screen.getByRole("combobox"));
    assert.equal(document.querySelectorAll('[role="listbox"]').length, 1);
    fireEvent.pointerDown(document.body, { button: 0 });
    await waitFor(() => assert.equal(document.querySelectorAll('[role="listbox"]').length, 0));
  } finally {
    view.unmount();
    cleanup();
  }
});

test("selected row carries a visible check", () => {
  const { view } = renderSelect();
  try {
    fireEvent.click(screen.getByRole("combobox"));
    const checks = Array.from(document.querySelectorAll(".glide-select__check"));
    assert.equal(checks.filter((el) => el.hasAttribute("data-on")).length, 1);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("option tags render beside the label", () => {
  const { view } = renderSelect({ options: [{ value: "a", label: "Alpha", tag: "T1" }, { value: "b", label: "Beta", tag: "T2" }] });
  try {
    fireEvent.click(screen.getByRole("combobox"));
    const tags = Array.from(document.querySelectorAll(".glide-select__tag")).map((el) => el.textContent);
    assert.deepEqual(tags, ["T1", "T2"]);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("press-drag scrub across rows commits the release row", async () => {
  const { calls, view } = renderSelect({ value: "a" });
  try {
    fireEvent.click(screen.getByRole("combobox"));
    await screen.findByRole("listbox");
    const list = document.querySelector(".glide-select__list");
    assert.ok(list);
    const rows = Array.from(document.querySelectorAll(".glide-select__option"));
    assert.equal(rows.length, 3);
    const at = (row) => 100 + 4 + row * 31 + 4;
    rows.forEach((row, i) => { row.getBoundingClientRect = () => ({ top: at(i), left: 0, right: 200, bottom: at(i) + 30, width: 200, height: 30, x: 0, y: at(i), toJSON() {} }); });
    list.getBoundingClientRect = () => ({ top: 100, left: 0, right: 200, bottom: 400, width: 200, height: 300, x: 0, y: 100, toJSON() {} });
    fireEvent.pointerDown(rows[0], { pointerId: 7, clientY: at(0), button: 0, pointerType: "mouse", bubbles: true });
    fireEvent.pointerMove(rows[1], { pointerId: 7, clientY: at(1), pointerType: "mouse", bubbles: true });
    fireEvent.pointerUp(rows[1], { pointerId: 7, clientY: at(1), pointerType: "mouse", bubbles: true });
    assert.deepEqual(calls, ["b"]);
    assert.equal(document.querySelectorAll('[role="listbox"]').length, 0);
  } finally {
    view.unmount();
    cleanup();
  }
});

test("rendered markup ships no hardcoded palette", () => {
  const { view } = renderSelect();
  try {
    fireEvent.click(screen.getByRole("combobox"));
    const html = document.body.innerHTML;
    assert.doesNotMatch(html, /#[0-9a-fA-F]{3}\b/);
  } finally {
    view.unmount();
    cleanup();
  }
});
test("trigger is a borderless content chip filling its wrapper", () => {
  const { view } = renderSelect();
  try {
    const trigger = screen.getByRole("combobox");
    const root = trigger.closest(".glide-select");
    assert.ok(root);
    assert.equal(getComputedStyle(trigger).borderStyle, "none");
    assert.ok(trigger.getBoundingClientRect().width <= root.getBoundingClientRect().width + 1);
  } finally {
    view.unmount();
    cleanup();
  }
});
