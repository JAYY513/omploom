import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
