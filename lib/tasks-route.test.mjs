import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const jiti = createJiti(import.meta.url, {
  alias: {
    "@/": fileURLToPath(new URL("../", import.meta.url)),
  },
});
const tasksRoute = await jiti.import("../app/api/tasks/route.ts");
const { invalidateSessionListCache } = await jiti.import("./session-reader.ts");
const { closeUsageDatabase } = await jiti.import("./usage-db.ts");

/** Point the omp agent dir at a throwaway location for the duration of `run`. */
async function withAgentDir(run) {
  const agentDir = mkdtempSync(join(tmpdir(), "omp-loom-tasks-route-"));
  const projectDir = join(agentDir, "sessions", "-project");
  mkdirSync(projectDir, { recursive: true });
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  invalidateSessionListCache();
  try {
    await run(projectDir);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    invalidateSessionListCache();
    closeUsageDatabase();
    rmSync(agentDir, { recursive: true, force: true });
  }
}

function writeSessionFile(dir, name, header, entries = []) {
  const filePath = join(dir, name);
  const lines = [JSON.stringify({ type: "session", version: 3, ...header })];
  for (const entry of entries) lines.push(JSON.stringify(entry));
  writeFileSync(filePath, `${lines.join("\n")}\n`);
  return filePath;
}

/** A transcript touched seconds ago reads as disk-running; age it so the
 * no-running assertions below stay about session shape, not freshness. */
function writeOldSessionFile(dir, name, header, entries = []) {
  const filePath = writeSessionFile(dir, name, header, entries);
  const past = new Date(Date.now() - 10 * 60_000);
  utimesSync(filePath, past, past);
  return filePath;
}

test("GET /api/tasks returns rows with running/usage/live shape and no-store ETag", async () => {
  await withAgentDir(async (dir) => {
    writeOldSessionFile(dir, "2026-09-20_a.jsonl", {
      id: "task-a",
      cwd: "/workspace/proj",
      timestamp: "2026-09-20T00:00:00.000Z",
    }, [
      { type: "message", id: "u1", parentId: null, timestamp: "2026-09-20T00:00:00.000Z", message: { role: "user", content: "hi" } },
    ]);
    writeOldSessionFile(dir, "2026-09-21_b.jsonl", {
      id: "task-b",
      cwd: "/workspace/proj",
      timestamp: "2026-09-21T00:00:00.000Z",
    });

    const res = await tasksRoute.GET(new Request("http://localhost/api/tasks"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    const etag = res.headers.get("ETag");
    assert.ok(etag, "ETag required for conditional GET");

    const body = await res.json();
    assert.equal(body.truncated, false);
    assert.equal(body.usageSynced, false, "cold DB must not block the list");
    assert.ok(typeof body.fetchedAt === "string");
    assert.equal(body.tasks.length, 2);
    // selectTaskSessions sorts newest-first; both ids must be present.
    assert.deepEqual(new Set(body.tasks.map((r) => r.id)), new Set(["task-a", "task-b"]));
    for (const row of body.tasks) {
      assert.equal(row.running, false, "old, untouched files are not running");
      assert.equal(row.usage, null);
      assert.equal(row.live, null);
      assert.ok(typeof row.path === "string" && row.path.length > 0);
      assert.ok(typeof row.modified === "string");
    }

    const cached = await tasksRoute.GET(
      new Request("http://localhost/api/tasks", { headers: { "If-None-Match": etag } }),
    );
    assert.equal(cached.status, 304);
  });
});

test("GET /api/tasks marks terminal-run transcripts as running from disk writes", async () => {
  await withAgentDir(async (dir) => {
    // A transcript omp just flushed in an external terminal: no RPC wrapper
    // exists, but the file is seconds old.
    writeSessionFile(dir, "2026-09-23_c.jsonl", {
      id: "task-c",
      cwd: "/workspace/proj",
      timestamp: "2026-09-23T00:00:00.000Z",
    }, [
      { type: "message", id: "u2", parentId: null, timestamp: "2026-09-23T00:00:00.000Z", message: { role: "user", content: "streaming" } },
    ]);

    const res = await tasksRoute.GET(new Request("http://localhost/api/tasks"));
    const body = await res.json();
    const row = body.tasks.find((r) => r.id === "task-c");
    assert.ok(row, "freshly written session is listed");
    assert.equal(row.running, true, "fresh transcript write without a wrapper reads as running");
    assert.equal(row.live, null, "no RPC snapshot for disk-detected runs");
  });
});
