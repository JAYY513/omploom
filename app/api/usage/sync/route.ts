import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { getUsageSyncState, startUsageSync } from "@/lib/usage-sync";
import type { UsageSyncStatus } from "@/lib/usage-types";

export const dynamic = "force-dynamic";

function toSyncStatus(): UsageSyncStatus {
  const { running, phase, processed, total, startedAt, finishedAt, error } = getUsageSyncState();
  return { running, phase, processed, total, startedAt, finishedAt, error };
}

/** Current sync progress; safe to poll. */
export async function GET() {
  return NextResponse.json(toSyncStatus());
}

/**
 * Kick off a background sync. `reset: true` re-parses every transcript from
 * scratch (schema/metric changes, or a user who wants the numbers rebuilt),
 * otherwise only new and changed files are read.
 */
export async function POST(req: Request) {
  try {
    let reset = false;
    try {
      const body = await req.json();
      reset = Boolean(body && typeof body === "object" && (body as { reset?: unknown }).reset);
    } catch {
      // No body / not JSON: incremental sync.
    }

    const status = startUsageSync({ reset });
    return NextResponse.json({ ...toSyncStatus(), started: status.running });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
