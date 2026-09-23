import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildTaskLive, countTodoTasks, groupTasksByProject, projectDotColor, selectTaskSessions, splitAttentionQueue } = await jiti.import("./tasks.ts");

const session = (id, modified, extra = {}) => ({
  path: `/s/${id}.jsonl`,
  id,
  cwd: `/w/${id}`,
  created: modified,
  modified,
  messageCount: 1,
  firstMessage: id,
  ...extra,
});

test("selectTaskSessions truncates but pins running sessions outside the window", () => {
  const sessions = [
    session("a", "2026-09-20T00:00:00.000Z"),
    session("b", "2026-09-21T00:00:00.000Z"),
    session("c", "2026-09-22T00:00:00.000Z"),
  ];
  const { selected, truncated } = selectTaskSessions(sessions, [{ id: "a", cwd: "/w/a" }], 2);
  assert.equal(truncated, true);
  // Head is newest-first; the running session is pinned even though truncated.
  assert.deepEqual(selected.map((s) => s.id), ["c", "b", "a"]);
});

test("selectTaskSessions synthesizes a placeholder for a running session with no file yet", () => {
  const { selected, truncated } = selectTaskSessions(
    [session("a", "2026-09-22T00:00:00.000Z")],
    [{ id: "fresh", cwd: "/w/fresh" }],
    300,
    "2026-09-22T01:00:00.000Z",
  );
  assert.equal(truncated, false);
  const row = selected.find((s) => s.id === "fresh");
  assert.ok(row);
  assert.equal(row.cwd, "/w/fresh");
  assert.equal(row.modified, "2026-09-22T01:00:00.000Z");
});

test("buildTaskLive extracts counts and tolerates missing fields", () => {
  const live = buildTaskLive({
    model: { id: "m", provider: "p", name: "M" },
    queuedMessageCount: 2,
    contextUsage: { tokens: 10, contextWindow: 100, percent: 10 },
    tokensPerSecond: 42,
    isCompacting: true,
    todoPhases: [
      { name: "x", tasks: [{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }] },
    ],
  });
  assert.equal(live.todoDone, 1);
  assert.equal(live.todoTotal, 2);
  assert.equal(live.modelId, "m");
  assert.equal(countTodoTasks(undefined).total, 0);
  const empty = buildTaskLive({});
  assert.equal(empty.queuedMessageCount, 0);
  assert.equal(empty.contextPercent, null);
  assert.equal(empty.todoTotal, 0);
});

const row = (id, modified, extra = {}) => ({ ...session(id, modified), projectRoot: "/w/proj", running: false, usage: null, live: null, ...extra });

test("splitAttentionQueue keeps review sticky and caps the read tail", () => {
  const tasks = [
    row("run", "2026-09-22T03:00:00.000Z", { running: true, created: "2026-09-22T02:00:00.000Z" }),
    row("new1", "2026-09-22T02:00:00.000Z"),
    row("new2", "2026-09-22T01:00:00.000Z"),
    row("old1", "2026-09-21T01:00:00.000Z"),
    row("old2", "2026-09-21T00:00:00.000Z"),
  ];
  const unread = new Set(["new1", "new2"]);
  const { running, review, read } = splitAttentionQueue(tasks, unread, 1);
  assert.deepEqual(running.map((r) => r.id), ["run"]);
  assert.deepEqual(review.map((r) => r.id), ["new1", "new2"], "sticky until opened, newest first");
  assert.deepEqual(read.map((r) => r.id), ["old1"], "read tail capped");
});

test("groupTasksByProject counts attention and orders hot cards first", () => {
  const tasks = [
    row("a1", "2026-09-22T01:00:00.000Z", { projectRoot: "/w/zzz" }),
    row("b1", "2026-09-22T02:00:00.000Z", { projectRoot: "/w/aaa", running: true }),
    row("b2", "2026-09-22T00:00:00.000Z", { projectRoot: "/w/aaa" }),
    row("c1", "2026-09-22T03:00:00.000Z", { projectRoot: "/W/AAA", worktreeBranch: "feat" }),
  ];
  const groups = groupTasksByProject(tasks, (root) => root.split("/").pop(), new Set(["a1"]));
  assert.equal(groups[0].label, "aaa", "hot card first despite alpha order");
  assert.equal(groups[0].rows.length, 3, "case-folded roots merge");
  assert.equal(groups[0].runningCount, 1);
  assert.equal(groups[1].reviewCount, 1);
});

test("projectDotColor is deterministic and case-folded", () => {
  assert.equal(projectDotColor("/w/AAA"), projectDotColor("/W/aaa"));
  assert.match(projectDotColor("/w/proj"), /^#/);
});

const { filterTaskRows, formatElapsed, parseCollapsedColumns, serializeCollapsedColumns, computeDiskRunningSessions, groupLaneRowsByProject } =
  await jiti.import("./tasks.ts");

test("filterTaskRows filters by project key and title substring", () => {
  const rows = [
    row("a1", "2026-09-22T01:00:00.000Z", { projectRoot: "/w/Alpha", name: "Fix the parser" }),
    row("a2", "2026-09-22T02:00:00.000Z", { projectRoot: "/W/ALPHA", firstMessage: "Ship the release" }),
    row("b1", "2026-09-22T03:00:00.000Z", { projectRoot: "/w/beta", name: "" }),
  ];
  assert.deepEqual(filterTaskRows(rows, null, "").map((r) => r.id), ["a1", "a2", "b1"], "no filter passes all");
  assert.deepEqual(filterTaskRows(rows, "/w/alpha", "").map((r) => r.id), ["a1", "a2"], "project key is case-folded");
  assert.deepEqual(filterTaskRows(rows, null, "PARSER").map((r) => r.id), ["a1"], "query matches name, case-insensitive");
  assert.deepEqual(filterTaskRows(rows, null, "release").map((r) => r.id), ["a2"], "query falls back to firstMessage");
  assert.deepEqual(filterTaskRows(rows, null, "  ship  ").map((r) => r.id), ["a2"], "query is trimmed");
  assert.deepEqual(filterTaskRows(rows, "/w/beta", "").map((r) => r.id), ["b1"], "nameless row matches by id title only");
  assert.deepEqual(filterTaskRows(rows, "/w/alpha", "release").map((r) => r.id), ["a2"], "filters compose");
});

test("formatElapsed renders a fixed-width stopwatch", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(41_000), "0:41");
  assert.equal(formatElapsed(61_000), "1:01");
  assert.equal(formatElapsed(3_661_000), "1:01:01");
  assert.equal(formatElapsed(-5), "0:00", "never negative");
});

test("collapsed columns round-trip and reject garbage", () => {
  const saved = serializeCollapsedColumns(new Set(["running", "read"]));
  assert.deepEqual([...parseCollapsedColumns(saved)], ["running", "read"]);
  assert.equal(parseCollapsedColumns(null).size, 0);
  assert.equal(parseCollapsedColumns("not json").size, 0);
  assert.equal(parseCollapsedColumns(JSON.stringify(["nope", "review"])).size, 1, "unknown ids drop");
  assert.equal(serializeCollapsedColumns(new Set()).length, 2, "empty set serializes to []");
});

const now = 1_790_129_000_000;
const stat = (p, mtimeMs) => ({ path: p, mtimeMs });
const emptyMap = new Map();

test("a freshly written transcript promotes to running", () => {
  const { runningPaths, snapshot } = computeDiskRunningSessions(
    [stat("/s/a.jsonl", now - 5_000), stat("/s/b.jsonl", now - 40_000)],
    emptyMap,
    now,
  );
  assert.deepEqual([...runningPaths], ["/s/a.jsonl"], "write within the fresh window is running");
  assert.equal(runningPaths.has("/s/b.jsonl"), false, "stale first sighting is not running");
  assert.equal(snapshot.get("/s/a.jsonl").running, true);
  assert.equal(snapshot.get("/s/b.jsonl").running, false);
});

test("a promoted file rides out silent stretches, then demotes", () => {
  const prev = new Map([["/s/a.jsonl", { mtimeMs: now - 90_000, observedAt: now - 60_000, running: true }]]);
  // 90s of silence: past the fresh window, inside the stay grace.
  const running = computeDiskRunningSessions([stat("/s/a.jsonl", now - 90_000)], prev, now);
  assert.equal(running.runningPaths.has("/s/a.jsonl"), true, "stay grace bridges silent tool calls");
  // 4 min of silence: the grace is exhausted.
  const demoted = computeDiskRunningSessions([stat("/s/a.jsonl", now - 240_000)], prev, now);
  assert.equal(demoted.runningPaths.has("/s/a.jsonl"), false, "silence past the grace demotes");
});

test("an unpromoted file never rides the stay grace", () => {
  const prev = new Map([["/s/a.jsonl", { mtimeMs: now - 90_000, observedAt: now - 90_000, running: false }]]);
  const { runningPaths } = computeDiskRunningSessions([stat("/s/a.jsonl", now - 90_000)], prev, now);
  assert.equal(runningPaths.has("/s/a.jsonl"), false, "only previously running files bridge silence");
});

test("entries absent from the observation are dropped from the snapshot", () => {
  const prev = new Map([
    ["/s/a.jsonl", { mtimeMs: now - 10_000, observedAt: now - 10_000, running: true }],
    ["/s/gone.jsonl", { mtimeMs: now - 10_000, observedAt: now - 10_000, running: true }],
  ]);
  const { snapshot } = computeDiskRunningSessions([stat("/s/a.jsonl", now - 10_000)], prev, now);
  assert.equal(snapshot.has("/s/gone.jsonl"), false);
  assert.equal(snapshot.size, 1);
});

test("groupLaneRowsByProject clusters lanes without reordering", () => {
  const rows = [
    row("a1", "2026-09-22T01:00:00.000Z", { projectRoot: "/w/Alpha", running: true }),
    row("b1", "2026-09-22T02:00:00.000Z", { projectRoot: "/W/BETA", running: true }),
    row("a2", "2026-09-22T03:00:00.000Z", { projectRoot: "/w/alpha", running: true }),
  ];
  const groups = groupLaneRowsByProject(rows, (root) => root.split("/").pop());
  assert.equal(groups.length, 2, "case-folded roots merge");
  assert.equal(groups[0].label, "Alpha", "group order follows first sighting");
  assert.deepEqual(groups[0].rows.map((r) => r.id), ["a1", "a2"], "within-group order kept");
  assert.deepEqual(groups[1].rows.map((r) => r.id), ["b1"]);
  assert.equal(groups[1].key, "/w/beta", "keys fold case");
});

test("groupLaneRowsByProject falls back to cwd for synthetic rows", () => {
  const rows = [row("fresh", "2026-09-22T01:00:00.000Z", { projectRoot: undefined, cwd: "/w/only", running: true })];
  const [group] = groupLaneRowsByProject(rows, (root) => root);
  assert.equal(group.label, "/w/only");
  assert.deepEqual(group.rows.map((r) => r.id), ["fresh"]);
});
