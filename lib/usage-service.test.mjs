import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
async function loadSubject() {
  return jiti.import("./usage-service.ts");
}

async function withTempSessionDir(run) {
  const dir = join(tmpdir(), `omp-test-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;

  const { closeUsageDatabase } = await jiti.import("./usage-db.ts");

  try {
    await run(dir);
  } finally {
    closeUsageDatabase();
    if (prevAgentDir !== undefined) {
      process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    } else {
      delete process.env.PI_CODING_AGENT_DIR;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("parseTranscriptUsage extracts assistant message usage with rate resolution", async () => {
  const { parseTranscriptUsage } = await loadSubject();

  withTempSessionDir((dir) => {
    const sessionFile = join(dir, "session-1.jsonl");
    const now = Date.now();

    const lines = [
      JSON.stringify({ type: "session", id: "sess-1", cwd: "/test/project-a", timestamp: new Date(now).toISOString() }),
      JSON.stringify({
        type: "message",
        id: "msg-1",
        parentId: null,
        timestamp: new Date(now - 1000).toISOString(),
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-3-7-sonnet",
          duration: 4200,
          usage: {
            input: 10000,
            output: 2000,
            cacheRead: 5000,
            cacheWrite: 1000,
            reasoning: 500,
          },
        },
      }),
      JSON.stringify({
        type: "message",
        id: "msg-2",
        parentId: "msg-1",
        timestamp: new Date(now).toISOString(),
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-4o",
          usage: {
            input: 4000,
            output: 1000,
            cacheRead: 2000,
            cacheWrite: 0,
          },
        },
      }),
    ];

    writeFileSync(sessionFile, lines.join("\n"), "utf8");

    const { records, stat } = parseTranscriptUsage(sessionFile, "main");
    assert.equal(records.length, 2);

    // Record 1: Anthropic Claude 3.7 Sonnet
    const r1 = records[0];
    assert.equal(r1.sessionId, "sess-1");
    assert.equal(r1.sessionCwd, "/test/project-a");
    assert.equal(r1.provider, "anthropic");
    assert.equal(r1.model, "claude-3-7-sonnet");
    assert.equal(r1.input, 10000);
    assert.equal(r1.output, 2000);
    assert.equal(r1.cacheRead, 5000);
    assert.equal(r1.cacheWrite, 1000);
    assert.equal(r1.reasoning, 500);
    assert.equal(r1.totalTokens, 18000);
    assert.equal(r1.costQuality, "model_priced");
    assert.equal(r1.agent, "main");
    assert.equal(r1.durationMs, 4200);
    assert.ok(r1.cost > 0);
    assert.ok(r1.cacheSavings > 0);

    // Record 2: OpenAI GPT-4o
    const r2 = records[1];
    assert.equal(r2.provider, "openai");
    assert.equal(r2.model, "gpt-4o");
    assert.equal(r2.durationMs, 0);
    assert.equal(r2.input, 4000);
    assert.equal(r2.output, 1000);
    assert.equal(r2.totalTokens, 7000);
    assert.ok(r2.cost > 0);

    // Rollup: the two model calls span ~1s, which is below the idle gap.
    assert.equal(stat.sessionId, "sess-1");
    assert.equal(stat.agent, "main");
    assert.equal(stat.messages, 2);
    assert.equal(stat.tokens, 25000);
    assert.equal(stat.modelMs, 4200);
    assert.equal(stat.endedAt - stat.startedAt, 1000);
    assert.equal(stat.activeMs, 1000);
  });
});

test("auxiliary model_usage calls count, aborted zero-token rows do not", async () => {
  const { parseTranscriptUsage } = await loadSubject();

  withTempSessionDir((dir) => {
    const sessionFile = join(dir, "session-aux.jsonl");
    const now = Date.now();

    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "sess-aux", cwd: "/test/aux", timestamp: new Date(now).toISOString() }),
        // Judge / auto-thinking call made on the session's behalf.
        JSON.stringify({
          type: "model_usage",
          id: "aux-1",
          timestamp: new Date(now - 2000).toISOString(),
          purpose: "auto-thinking",
          role: "judge",
          provider: "anthropic",
          model: "claude-3-7-sonnet",
          usage: { input: 900, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 1000 },
        }),
        // Aborted call: all-zero usage must not become a record.
        JSON.stringify({
          type: "model_usage",
          id: "aux-2",
          timestamp: new Date(now - 1000).toISOString(),
          purpose: "auto-thinking",
          role: "judge",
          provider: "anthropic",
          model: "claude-3-7-sonnet",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: "aborted",
          errorMessage: "Request was aborted",
        }),
        JSON.stringify({
          type: "message",
          timestamp: new Date(now).toISOString(),
          message: {
            role: "assistant",
            provider: "anthropic",
            model: "claude-3-7-sonnet",
            usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const { records, stat } = parseTranscriptUsage(sessionFile, "main");

    assert.equal(records.length, 2);
    assert.equal(records[0].totalTokens, 1000);
    assert.equal(records[0].agent, "main");
    assert.equal(records[1].totalTokens, 1100);
    assert.equal(stat.tokens, 2100);
    // Auxiliary calls do not define the chat span: only the turn does.
    assert.equal(stat.startedAt, stat.endedAt);
    assert.equal(stat.activeMs, 0);
  });
});

test("user prompts delimit task turns; auxiliary calls join the open turn", async () => {
  const { parseTranscriptUsage } = await loadSubject();

  withTempSessionDir((dir) => {
    const sessionFile = join(dir, "session-turns.jsonl");
    const now = Date.now();

    const lines = [
      JSON.stringify({ type: "session", id: "sess-turns", cwd: "/test/project-a", timestamp: new Date(now).toISOString() }),
      // Auxiliary call before the first prompt: joins turn 1, never "turn 0".
      JSON.stringify({
        type: "model_usage",
        timestamp: new Date(now - 4000).toISOString(),
        provider: "anthropic",
        model: "claude-3-7-sonnet",
        usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 },
      }),
      JSON.stringify({
        type: "message",
        timestamp: new Date(now - 3000).toISOString(),
        message: { role: "user", content: "question one" },
      }),
      JSON.stringify({
        type: "message",
        timestamp: new Date(now - 2000).toISOString(),
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-3-7-sonnet",
          usage: { input: 100, output: 100, cacheRead: 500, cacheWrite: 0 },
        },
      }),
      JSON.stringify({
        type: "message",
        timestamp: new Date(now - 1000).toISOString(),
        message: { role: "user", content: "question two" },
      }),
      JSON.stringify({
        type: "message",
        timestamp: new Date(now - 500).toISOString(),
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-3-7-sonnet",
          usage: { input: 200, output: 200, cacheRead: 500, cacheWrite: 0 },
        },
      }),
      // Second call inside the same turn (branch sibling / continuation).
      JSON.stringify({
        type: "message",
        timestamp: new Date(now - 400).toISOString(),
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-3-7-sonnet",
          usage: { input: 50, output: 50, cacheRead: 500, cacheWrite: 0 },
        },
      }),
    ];

    writeFileSync(sessionFile, lines.join("\n"), "utf8");

    const { records } = parseTranscriptUsage(sessionFile, "main");
    assert.equal(records.length, 4);
    assert.deepEqual(
      records.map((record) => record.turnIndex),
      [1, 1, 2, 2],
    );
  });
});

test("subagent usage is counted once, from its own nested transcript", async () => {
  const { getUsageReport } = await loadSubject();

  await withTempSessionDir(async (dir) => {
    const projectDir = join(dir, "sessions", "test-project");
    const sessionFile = join(projectDir, "session-task.jsonl");
    const artifactsDir = join(projectDir, "session-task");
    mkdirSync(artifactsDir, { recursive: true });
    const now = Date.now();

    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "sess-task", cwd: "/test/repo", timestamp: new Date(now).toISOString() }),
        JSON.stringify({
          type: "message",
          timestamp: new Date(now).toISOString(),
          message: {
            role: "assistant",
            provider: "anthropic",
            model: "claude-3-7-sonnet",
            usage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 },
          },
        }),
        // The parent's task tool result repeats the subagent's own totals. It
        // must NOT be added on top of the subagent transcript below, and
        // (unlike the replay snapshot) it carries no per-call timestamps.
        JSON.stringify({
          type: "message",
          timestamp: new Date(now).toISOString(),
          message: {
            role: "toolResult",
            toolName: "task",
            details: {
              results: [
                {
                  agent: "scout",
                  resolvedModel: "google/gemini-2.5-flash",
                  usage: { input: 8000, output: 500, cacheRead: 4000, cacheWrite: 0 },
                },
              ],
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    writeFileSync(
      join(artifactsDir, "Scout.jsonl"),
      [
        JSON.stringify({ type: "session", id: "sub-scout", cwd: "/test/repo", timestamp: new Date(now).toISOString() }),
        JSON.stringify({
          type: "message",
          timestamp: new Date(now - 500).toISOString(),
          message: {
            role: "assistant",
            provider: "google",
            model: "gemini-2.5-flash",
            usage: { input: 500, output: 200, cacheRead: 0, cacheWrite: 0 },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const report = await getUsageReport({ range: "all", forceRefresh: true });

    // 1200 (main) + 700 (subagent) — the toolResult's 12500 replay is ignored.
    assert.equal(report.summary.totalTokens, 1900);
    assert.equal(report.scanInfo.transcriptsScanned, 2);

    const byAgent = new Map(report.overview.byAgent.map((row) => [row.agent, row]));
    assert.equal(byAgent.get("main").tokens, 1200);
    assert.equal(byAgent.get("subagent").tokens, 700);
    assert.equal(byAgent.has("advisor"), false);

    // Subagent spend is attributable to its own model, not the parent's.
    assert.ok(report.modelBreakdown.some((row) => row.model === "gemini-2.5-flash"));
    // Chats are conversations: a subagent transcript never wins the ranking.
    assert.equal(report.overview.longestSession.agent, "main");
    assert.equal(report.overview.totalTokens, 1900);
  });
});

test("getUsageReport generates complete aggregated report across sessions", async () => {
  const { getUsageReport } = await loadSubject();

  withTempSessionDir(async (dir) => {
    const sessionsDir = join(dir, "sessions", "test-project");
    mkdirSync(sessionsDir, { recursive: true });

    const now = Date.now();
    const session1 = join(sessionsDir, "session-a.jsonl");
    const session2 = join(sessionsDir, "session-b.jsonl");

    writeFileSync(
      session1,
      [
        JSON.stringify({ type: "session", id: "sess-a", cwd: "/home/user/project-alpha", timestamp: new Date(now).toISOString() }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            provider: "anthropic",
            model: "claude-3-7-sonnet",
            usage: { input: 20000, output: 4000, cacheRead: 10000, cacheWrite: 0, reasoning: 1000 },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    writeFileSync(
      session2,
      [
        JSON.stringify({ type: "session", id: "sess-b", cwd: "/home/user/project-beta", timestamp: new Date(now).toISOString() }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            provider: "openai",
            model: "gpt-4o",
            usage: { input: 10000, output: 2000, cacheRead: 0, cacheWrite: 0 },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const report = await getUsageReport({ range: "30d", forceRefresh: true });

    assert.equal(report.timeRange, "30d");
    assert.equal(report.granularity, "daily");

    // Summary checks
    assert.ok(report.summary.totalCost > 0);
    assert.equal(report.summary.inputTokens, 30000);
    assert.equal(report.summary.outputTokens, 6000);
    assert.equal(report.summary.cacheReadTokens, 10000);
    assert.equal(report.summary.reasoningTokens, 1000);
    assert.equal(report.summary.totalTokens, 46000);
    assert.ok(report.summary.activeDays >= 1);
    assert.ok(report.summary.cachePercentage > 0);

    // Providers checks
    assert.equal(report.providers.length, 2);
    const anthropicProvider = report.providers.find((p) => p.provider === "anthropic");
    const openaiProvider = report.providers.find((p) => p.provider === "openai");
    assert.ok(anthropicProvider);
    assert.ok(openaiProvider);
    assert.equal(anthropicProvider.name, "Anthropic");
    assert.equal(openaiProvider.name, "OpenAI");

    // Model breakdown checks
    assert.equal(report.modelBreakdown.length, 2);
    assert.ok(report.modelBreakdown.some((m) => m.model === "claude-3-7-sonnet"));
    assert.ok(report.modelBreakdown.some((m) => m.model === "gpt-4o"));

    // Project breakdown checks
    assert.equal(report.projectBreakdown.length, 2);
    assert.ok(report.projectBreakdown.some((p) => p.projectName === "project-alpha"));
    assert.ok(report.projectBreakdown.some((p) => p.projectName === "project-beta"));

    // Time series checks: continuous buckets
    assert.ok(report.timeSeries.length >= 1);
    const lastPoint = report.timeSeries[report.timeSeries.length - 1];
    assert.ok(lastPoint.date);
    assert.ok(lastPoint.label);

    // Scan info
    assert.equal(report.scanInfo.transcriptsScanned, 2);
    assert.equal(report.scanInfo.usageRecordsCount, 2);
    assert.ok(report.scanInfo.durationSeconds >= 0);

    // Overview: all-time headline block for the dashboard
    assert.equal(report.overview.totalTokens, 46000);
    assert.equal(report.overview.totalRequests, 2);
    assert.equal(report.overview.activeDays, 1);
    assert.equal(report.overview.streaks.currentDays, 1);
    assert.equal(report.overview.streaks.longestDays, 1);
    assert.equal(report.overview.peakDay.tokens, 46000);
    assert.equal(report.overview.activity.length, 1);
    assert.equal(report.overview.activity[0].tokens, 46000);
    assert.equal(report.overview.byAgent.length, 1);
    assert.equal(report.overview.byAgent[0].agent, "main");
    // Timestamps are absent from these fixtures, so the rollup falls back to
    // the session header — a chat with no measurable span still ranks.
    assert.equal(report.overview.longestSession.agent, "main");
  });
});

test("time range bounds compute valid intervals", async () => {
  const { computeTimeRangeBounds } = await loadSubject();

  const now = 1756700000000;
  const t7d = computeTimeRangeBounds("7d", now);
  assert.equal(t7d.endMs, now);
  assert.equal(t7d.startMs, now - 7 * 86400 * 1000);

  const tAll = computeTimeRangeBounds("all", now);
  assert.equal(tAll.startMs, 0);
  assert.equal(tAll.endMs, now);
});

test("getUsageReport respects explicit from=0 timestamp without falling back to 30d", async () => {
  const { getUsageReport } = await loadSubject();

  withTempSessionDir(async (dir) => {
    const sessionsDir = join(dir, "sessions", "test-project");
    mkdirSync(sessionsDir, { recursive: true });

    // An old session 100 days ago
    const oldTimestamp = Date.now() - 100 * 86400 * 1000;
    const sessionFile = join(sessionsDir, "old-session.jsonl");

    writeFileSync(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "sess-old", cwd: "/test/old", timestamp: new Date(oldTimestamp).toISOString() }),
        JSON.stringify({
          type: "message",
          timestamp: new Date(oldTimestamp).toISOString(),
          message: {
            role: "assistant",
            provider: "openai",
            model: "gpt-4o",
            usage: { input: 5000, output: 1000 },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    // Querying with from: 0 explicitly must find the 100-day old record
    const report = await getUsageReport({ from: 0, to: Date.now(), forceRefresh: true });
    assert.equal(report.summary.inputTokens, 5000);
    assert.equal(report.scanInfo.usageRecordsCount, 1);
  });
});

test("usage cache evicts oldest entries when exceeding MAX_USAGE_CACHE_ENTRIES", async () => {
  const { parseTranscriptUsage, MAX_USAGE_CACHE_ENTRIES } = await loadSubject();

  withTempSessionDir((dir) => {
    // Create 10 dummy session files
    for (let i = 0; i < 10; i++) {
      const f = join(dir, `s-${i}.jsonl`);
      writeFileSync(f, JSON.stringify({ type: "session", id: `s-${i}`, cwd: "/p" }), "utf8");
      parseTranscriptUsage(f, "main");
    }
    assert.ok(MAX_USAGE_CACHE_ENTRIES > 0);
  });
});
