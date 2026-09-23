import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./usage-metrics.ts");
}

/** Fixed clock: 2026-09-22 is a Tuesday, so its week runs Sun 09-20 → Sat 09-26. */
const TODAY = new Date(2026, 8, 22, 12, 0, 0);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

test("heatmap keeps a rectangle: 53 weeks of 7 days, future days empty", async () => {
  const { buildActivityHeatmap } = await loadSubject();

  const model = buildActivityHeatmap([], { today: TODAY, monthNames: MONTHS });

  assert.equal(model.weeks.length, 53);
  for (const week of model.weeks) assert.equal(week.cells.length, 7);

  const flat = model.weeks.flatMap((week) => week.cells);
  const future = flat.filter((cell) => !cell.inWindow);
  // 09-20 (Sun) through 09-22 (Tue) are in window; Wed..Sat of that week are not.
  assert.deepEqual(
    future.map((cell) => cell.day),
    ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"],
  );
  assert.equal(flat[0].day, "2025-09-21");
  assert.equal(flat[flat.length - 1].day, "2026-09-26");
});

test("heatmap daily mode buckets intensity against the window max", async () => {
  const { buildActivityHeatmap } = await loadSubject();

  const model = buildActivityHeatmap(
    [
      { day: "2026-09-20", tokens: 100, cost: 1 },
      { day: "2026-09-22", tokens: 400, cost: 2 },
    ],
    { today: TODAY, monthNames: MONTHS },
  );
  const byDay = new Map(model.weeks.flatMap((week) => week.cells).map((cell) => [cell.day, cell]));

  assert.equal(model.max, 400);
  assert.equal(byDay.get("2026-09-22").level, 4);
  assert.equal(byDay.get("2026-09-20").level, 1);
  assert.equal(byDay.get("2026-09-21").level, 0);
  assert.equal(byDay.get("2026-09-21").value, 0);
  assert.equal(model.totalTokens, 500);
});

test("heatmap weekly mode spreads each column's total and cumulative only grows", async () => {
  const { buildActivityHeatmap } = await loadSubject();

  const points = [
    { day: "2026-09-20", tokens: 100, cost: 0 },
    { day: "2026-09-22", tokens: 400, cost: 0 },
    { day: "2026-09-14", tokens: 50, cost: 0 },
  ];

  const weekly = buildActivityHeatmap(points, { today: TODAY, mode: "weekly", monthNames: MONTHS });
  const weeklyByDay = new Map(weekly.weeks.flatMap((week) => week.cells).map((cell) => [cell.day, cell]));
  // Sun+Tue share a column, so both read the week's 500 tokens.
  assert.equal(weeklyByDay.get("2026-09-20").value, 500);
  assert.equal(weeklyByDay.get("2026-09-22").value, 500);
  assert.equal(weeklyByDay.get("2026-09-21").value, 500);

  const cumulative = buildActivityHeatmap(points, { today: TODAY, mode: "cumulative", monthNames: MONTHS });
  const cumByDay = new Map(cumulative.weeks.flatMap((week) => week.cells).map((cell) => [cell.day, cell]));
  assert.equal(cumByDay.get("2026-09-14").value, 50);
  assert.equal(cumByDay.get("2026-09-20").value, 150);
  assert.equal(cumByDay.get("2026-09-22").value, 550);
  assert.equal(cumulative.max, 550);
});

test("heatmap labels months at the column where they start", async () => {
  const { buildActivityHeatmap } = await loadSubject();

  const model = buildActivityHeatmap([], { today: TODAY, monthNames: MONTHS });

  const labels = model.monthLabels.map((entry) => entry.label);
  assert.equal(labels[0], "Sep");
  assert.equal(labels[labels.length - 1], "Sep");
  // A 53-week window touches 13 month starts; the two September columns are
  // the year-apart ends, so the label text itself only repeats once.
  assert.equal(labels.length, 13);
  assert.equal(new Set(labels).size, 12);
  for (const entry of model.monthLabels) {
    assert.ok(entry.weekIndex >= 0 && entry.weekIndex < 53);
  }
});

test("streaks count today, tolerate yesterday, and break on a gap", async () => {
  const { computeStreaks } = await loadSubject();

  assert.deepEqual(computeStreaks([], TODAY), { current: 0, longest: 0 });
  assert.deepEqual(computeStreaks(["2026-09-22"], TODAY), { current: 1, longest: 1 });
  assert.deepEqual(computeStreaks(["2026-09-19", "2026-09-20", "2026-09-21"], TODAY), {
    current: 3,
    longest: 3,
  });
  // Chain ending two days ago is no longer current, but keeps the record.
  assert.deepEqual(computeStreaks(["2026-09-17", "2026-09-18"], TODAY), { current: 0, longest: 2 });
  // Longest run survives behind a gap and month boundaries.
  assert.deepEqual(
    computeStreaks(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-10", "2026-09-22"], TODAY),
    { current: 1, longest: 3 },
  );
});

test("peak day picks the heaviest day and reports nothing for empty input", async () => {
  const { pickPeakDay } = await loadSubject();

  assert.equal(pickPeakDay([]), null);
  assert.equal(pickPeakDay([{ day: "2026-09-21", tokens: 0, cost: 0 }]), null);
  assert.deepEqual(
    pickPeakDay([
      { day: "2026-09-20", tokens: 100, cost: 1 },
      { day: "2026-09-21", tokens: 900, cost: 2 },
    ]),
    { day: "2026-09-21", tokens: 900, cost: 2 },
  );
});

test("active span drops idle gaps but keeps engaged time", async () => {
  const { computeActiveSpanMs, DEFAULT_IDLE_GAP_MS } = await loadSubject();

  const minute = 60 * 1000;
  const base = TODAY.getTime();

  assert.equal(computeActiveSpanMs([]), 0);
  assert.equal(computeActiveSpanMs([{ timestamp: base }]), 0);
  // 5 min + 10 min engaged, then an overnight gap that must not count.
  assert.equal(
    computeActiveSpanMs([
      { timestamp: base },
      { timestamp: base + 5 * minute },
      { timestamp: base + 15 * minute },
      { timestamp: base + 20 * 60 * minute },
    ]),
    15 * minute,
  );
  assert.equal(DEFAULT_IDLE_GAP_MS, 30 * minute);
  assert.equal(
    computeActiveSpanMs([{ timestamp: base }, { timestamp: base + 40 * minute }]),
    0,
  );
});

test("daily series zero-fills every day in the range", async () => {
  const { fillDailySeries } = await loadSubject();

  const series = fillDailySeries(
    [{ day: "2026-09-21", tokens: 7, cost: 0.5 }],
    new Date(2026, 8, 20, 23, 59).getTime(),
    new Date(2026, 8, 22, 0, 1).getTime(),
  );

  assert.deepEqual(
    series.map((point) => point.day),
    ["2026-09-20", "2026-09-21", "2026-09-22"],
  );
  assert.deepEqual(
    series.map((point) => point.tokens),
    [0, 7, 0],
  );
});

test("compact token formatting follows the locale's unit system", async () => {
  const { formatCompactTokens } = await loadSubject();

  assert.equal(formatCompactTokens(999), "999");
  assert.equal(formatCompactTokens(12_500), "12.5K");
  assert.equal(formatCompactTokens(19_900_574_110, "en"), "19.9B");
  assert.equal(formatCompactTokens(35_450_000, "zh-CN"), "3545万");
  assert.equal(formatCompactTokens(19_900_574_110, "zh-CN"), "199亿");
  assert.equal(formatCompactTokens(19_900_574_110, "ja"), "199亿");
  assert.equal(formatCompactTokens(0, "zh-CN"), "0");
});

test("model usage ranks by the active sort key with the other metric as tie-break", async () => {
  const { rankModelUsage } = await loadSubject();

  const rows = [
    // Cheap in tokens but the most expensive model: cost ordering puts it
    // first, token ordering keeps the token-ordered bars sorted. Each
    // per-task metric shapes its own ordering (see assertions below).
    {
      model: "expensive", provider: "a", tokens: 1_000, cost: 90,
      avgTokensPerTask: 200, avgCostPerTask: 10, medianTokensPerTask: 50, taskCount: 4,
    },
    {
      model: "heavy", provider: "a", tokens: 50_000, cost: 1,
      avgTokensPerTask: 500, avgCostPerTask: 5, medianTokensPerTask: 450, taskCount: 2,
    },
    {
      model: "grok-4.6", provider: "xai-oauth", tokens: 5_000, cost: 3,
      avgTokensPerTask: 200, avgCostPerTask: 20, medianTokensPerTask: 200, taskCount: 3,
    },
    {
      model: "grok-4.6", provider: "packCode", tokens: 2_000, cost: 2,
      avgTokensPerTask: 300, avgCostPerTask: 20, medianTokensPerTask: 100, taskCount: 10,
    },
  ];

  const ranked = rankModelUsage(rows);
  assert.deepEqual(
    ranked.map((entry) => entry.row.model),
    ["heavy", "grok-4.6", "grok-4.6", "expensive"],
  );
  // Bar width is relative to the heaviest row.
  assert.equal(ranked[0].shareOfMax, 100);
  assert.equal(ranked[3].shareOfMax, 2);
  // Duplicated model ids spell out the provider; unique ones stay clean.
  assert.equal(ranked[0].label, "heavy");
  assert.deepEqual(
    ranked.slice(1, 3).map((entry) => entry.label),
    ["grok-4.6 · xai-oauth", "grok-4.6 · packCode"],
  );
  assert.deepEqual(
    ranked.slice(1, 3).map((entry) => entry.key),
    ["xai-oauth:grok-4.6", "packCode:grok-4.6"],
  );

  const byCost = rankModelUsage(rows, "cost");
  assert.deepEqual(
    byCost.map((entry) => [entry.row.model, entry.row.provider]),
    [
      ["expensive", "a"],
      ["grok-4.6", "xai-oauth"],
      ["grok-4.6", "packCode"],
      ["heavy", "a"],
    ],
  );
  // $0 priciest still sorts: the cost metric is the max, not tokens.
  assert.equal(byCost[0].shareOfMax, 100);
  assert.equal(byCost[3].shareOfMax, (1 / 90) * 100);

  // Per-task average: cost per task breaks the tie between the two 200-token
  // rows. Bars draw the per-task metric.
  const byAvg = rankModelUsage(rows, "taskAvg");
  assert.deepEqual(
    byAvg.map((entry) => [entry.row.model, entry.row.provider]),
    [
      ["heavy", "a"],
      ["grok-4.6", "packCode"],
      ["grok-4.6", "xai-oauth"],
      ["expensive", "a"],
    ],
  );
  assert.equal(byAvg[0].shareOfMax, 100);
  assert.equal(byAvg[3].shareOfMax, 40);

  // Median, cost-per-task and task count each shape their own ordering.
  const order = (ranked) => ranked.map((entry) => [entry.row.model, entry.row.provider]);
  assert.deepEqual(order(rankModelUsage(rows, "taskMedian")), [
    ["heavy", "a"],
    ["grok-4.6", "xai-oauth"],
    ["grok-4.6", "packCode"],
    ["expensive", "a"],
  ]);
  // Equal cost per task falls back to avg tokens per task (packCode eats more).
  assert.deepEqual(order(rankModelUsage(rows, "taskCost")), [
    ["grok-4.6", "packCode"],
    ["grok-4.6", "xai-oauth"],
    ["expensive", "a"],
    ["heavy", "a"],
  ]);
  assert.deepEqual(order(rankModelUsage(rows, "taskCount")), [
    ["grok-4.6", "packCode"],
    ["expensive", "a"],
    ["grok-4.6", "xai-oauth"],
    ["heavy", "a"],
  ]);
  assert.deepEqual(rankModelUsage([]), []);
  assert.deepEqual(rankModelUsage([], "cost"), []);
  assert.deepEqual(rankModelUsage([], "taskAvg"), []);
});

test("duration parts keep at most two non-zero units", async () => {
  const { formatDurationParts } = await loadSubject();
  const units = { day: "d", hour: "h", minute: "m", second: "s" };

  assert.deepEqual(formatDurationParts(0, units), ["0s"]);
  assert.deepEqual(formatDurationParts(75 * 60 * 1000, units), ["1h", "15m"]);
  assert.deepEqual(formatDurationParts(26 * 60 * 60 * 1000, units), ["1d", "2h"]);
  assert.deepEqual(formatDurationParts(45 * 1000, units), ["45s"]);
});
