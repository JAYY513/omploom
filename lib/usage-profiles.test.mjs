import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
async function loadPaths() {
  return jiti.import("./omp/paths.ts");
}
async function loadDb() {
  return jiti.import("./usage-db.ts");
}

function tempDir(label) {
  const dir = join(tmpdir(), `omp-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Minimal transcript: one session header plus one priced assistant message. */
function transcript(id, cwd, tokens, at) {
  return [
    JSON.stringify({ type: "session", id, cwd, timestamp: new Date(at).toISOString() }),
    JSON.stringify({
      type: "message",
      timestamp: new Date(at).toISOString(),
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-3-7-sonnet",
        usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    }),
  ].join("\n");
}

test("named profiles are discovered from the config root, unused ones skipped", async () => {
  const { listUsageSessionRoots, listProfileNames, getProfileSessionsDir } = await loadPaths();

  const configRoot = tempDir("profiles");
  try {
    // work: a real session tree. empty: a profile dir with no sessions yet.
    mkdirSync(join(configRoot, "profiles", "work", "agent", "sessions", "proj"), { recursive: true });
    mkdirSync(join(configRoot, "profiles", "empty"), { recursive: true });
    mkdirSync(join(configRoot, "profiles", "not a profile"), { recursive: true });

    assert.deepEqual(listProfileNames(configRoot), ["empty", "work"]);
    assert.equal(getProfileSessionsDir("empty", configRoot), undefined);

    const roots = listUsageSessionRoots(configRoot);
    // The default profile always leads; only profiles with sessions follow.
    assert.equal(roots[0].profile, "");
    assert.deepEqual(
      roots.slice(1).map((root) => root.profile),
      ["work"],
    );
    assert.ok(roots[1].sessionsRoot.endsWith(join("profiles", "work", "agent", "sessions")));
  } finally {
    rmSync(configRoot, { recursive: true, force: true });
  }
});

test("usage from a named profile is counted and labelled separately", async () => {
  const { syncUsageFiles, getUsageReportFromDb, getUsageDatabase, closeUsageDatabase } = await loadDb();

  const agentDir = tempDir("usage-profiles");
  const db = getUsageDatabase(join(agentDir, "usage.db"));

  try {
    const now = Date.now();
    const defaultRoot = join(agentDir, "sessions");
    const workRoot = join(tempDir("usage-profiles-config"), "profiles", "work", "agent", "sessions");
    mkdirSync(join(defaultRoot, "proj"), { recursive: true });
    mkdirSync(join(workRoot, "proj", "work"), { recursive: true });

    writeFileSync(
      join(defaultRoot, "proj", "default.jsonl"),
      transcript("sess-default", "/p/default", 1000, now),
      "utf8",
    );
    writeFileSync(join(workRoot, "proj", "work.jsonl"), transcript("sess-work", "/p/work", 2500, now - 60_000), "utf8");
    // Nested artifacts keep working inside a profile tree.
    writeFileSync(
      join(workRoot, "proj", "work", "Scout.jsonl"),
      transcript("sess-work-scout", "/p/work", 500, now - 30_000),
      "utf8",
    );

    const stats = await syncUsageFiles({
      sources: [
        { profile: "", sessionsRoot: defaultRoot },
        { profile: "work", sessionsRoot: workRoot },
      ],
      db,
    });
    assert.equal(stats.filesScanned, 3);
    assert.equal(stats.recordsInserted, 3);

    const report = await getUsageReportFromDb({ range: "all", skipSync: true }, db);

    assert.equal(report.overview.totalTokens, 4000);
    assert.deepEqual(
      report.overview.byProfile.map((row) => [row.profile, row.tokens]),
      [
        ["work", 3000],
        ["", 1000],
      ],
    );
    // Profile attribution must not disturb the agent split.
    const byAgent = new Map(report.overview.byAgent.map((row) => [row.agent, row.tokens]));
    assert.equal(byAgent.get("main"), 3500);
    assert.equal(byAgent.get("subagent"), 500);
  } finally {
    closeUsageDatabase();
    rmSync(agentDir, { recursive: true, force: true });
  }
});
