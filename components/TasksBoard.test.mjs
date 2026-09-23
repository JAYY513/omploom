import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const { TasksBoard } = await jiti.import("./TasksBoard.tsx");

test("TasksBoard shell renders without crashing", () => {
  const html = renderToStaticMarkup(React.createElement(TasksBoard, { onClose() {}, onSelectSession() {} }));
  assert.ok(html.length > 0, "board shell renders");
});

test("tasks API route never spawns idle RPC sessions", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../app/api/tasks/route.ts", import.meta.url), "utf8");
  assert.ok(!/\bstartRpcSession\s*\(/.test(route), "no startRpcSession() calls");
  assert.match(route, /getRpcSession/);
  assert.match(route, /getTaskUsageForFiles/);
});

test("board header uses the summary bar and view switch keys", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./TasksBoard.tsx", import.meta.url), "utf8");
  assert.match(source, /tasksBoard\.allClear/);
  assert.match(source, /tasksBoard\.burnToday/);
  assert.match(source, /tasksBoard\.summaryLabel/);
  assert.match(source, /tasksBoard\.viewLabel/);
  assert.match(source, /view\$\{key/);
  assert.match(source, /tasksBoard\.sidebarHint/);
  assert.match(source, /saveUnreadSessionIds/);
});

test("board renders attention lanes with collapse persistence and toolbar filters", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./TasksBoard.tsx", import.meta.url), "utf8");
  // Three lanes: running / review / read, each a collapsible column.
  assert.match(source, /tasks-board-lanes/);
  assert.match(source, /data-column=\{id\}/);
  assert.match(source, /aria-expanded=\{!collapsed\}/);
  assert.match(source, /tasksBoard\.emptyRunning/);
  // Collapse state survives reloads through localStorage.
  assert.match(source, /omp-loom:tasks-collapsed-columns/);
  assert.match(source, /parseCollapsedColumns/);
  // Toolbar: project chips + title search + group-by-project lanes.
  assert.match(source, /tasksBoard\.filterAll/);
  assert.match(source, /tasksBoard\.searchPlaceholder/);
  assert.match(source, /tasksBoard\.groupByProject/);
  assert.match(source, /tasksBoard\.noMatches/);
  assert.match(source, /groupLaneRowsByProject/);
  assert.match(source, /omp-loom:tasks-grouped/);
  // Running cards carry the live stopwatch + context gauge.
  assert.match(source, /formatElapsed/);
  assert.match(source, /tasksBoard\.elapsed/);
  assert.match(source, /CtxBar/);
});

test("sidebar tasks badge counts running plus unreviewed", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  assert.match(source, /runningSessionIds\.size \+ unreadSessionIds\.size/);
  assert.match(source, /tasksBoard\.attentionBadge/);
});
