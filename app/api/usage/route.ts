import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { getUsageReport } from "@/lib/usage-service";
import { hasSyncedUsage } from "@/lib/usage-db";
import { getUsageSyncState, isUsageSyncRunning, startUsageSync } from "@/lib/usage-sync";
import type { UsageGranularity, UsageReport, UsageSyncStatus, UsageTimeRange } from "@/lib/usage-types";

export const dynamic = "force-dynamic";

/** Query-shape parts of the cache key; the sync generation is appended so a
 * finished sync always lands on a fresh entry. */
const REPORT_CACHE_TTL_MS = 2500;

interface ReportCacheEntry {
  at: number;
  report: UsageReport;
}

declare global {
  var __ompUsageReportCache: Map<string, ReportCacheEntry> | undefined;
}

function getReportCache(): Map<string, ReportCacheEntry> {
  if (!globalThis.__ompUsageReportCache) globalThis.__ompUsageReportCache = new Map();
  return globalThis.__ompUsageReportCache;
}

function toSyncStatus(): UsageSyncStatus {
  const { running, phase, processed, total, startedAt, finishedAt, error } = getUsageSyncState();
  return { running, phase, processed, total, startedAt, finishedAt, error };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rangeParam = url.searchParams.get("range");
    const granularityParam = url.searchParams.get("granularity");
    const projectParam = url.searchParams.get("project");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const refreshParam = url.searchParams.get("refresh");

    const validRanges: UsageTimeRange[] = ["today", "7d", "30d", "90d", "month", "all"];
    const range: UsageTimeRange = validRanges.includes(rangeParam as UsageTimeRange)
      ? (rangeParam as UsageTimeRange)
      : "30d";

    const validGranularities: UsageGranularity[] = ["daily", "monthly", "projects"];
    const granularity: UsageGranularity = validGranularities.includes(granularityParam as UsageGranularity)
      ? (granularityParam as UsageGranularity)
      : "daily";

    const from = fromParam ? parseInt(fromParam, 10) : undefined;
    const to = toParam ? parseInt(toParam, 10) : undefined;
    const forceRefresh = refreshParam === "true" || refreshParam === "1";

    // A cold history is a minute of parsing: hand it to the background job and
    // answer with whatever the database holds so far (the client polls).
    const cold = !hasSyncedUsage();
    if (cold && !isUsageSyncRunning()) {
      startUsageSync();
    }
    const syncing = isUsageSyncRunning();
    const syncStatus = toSyncStatus();

    // The dashboard polls while a sync runs and re-reads on every range toggle;
    // the aggregates cost ~1.5s, so identical requests inside the TTL reuse the
    // previous answer. The sync generation in the key means a completed sync
    // never serves pre-sync numbers.
    const cacheKey = [
      range,
      granularity,
      projectParam || "",
      from ?? "",
      to ?? "",
      syncStatus.finishedAt ?? 0,
    ].join("|");
    const cache = getReportCache();
    const cached = cache.get(cacheKey);
    if (!forceRefresh && !syncing && cached && Date.now() - cached.at < REPORT_CACHE_TTL_MS) {
      return NextResponse.json({ ...cached.report, sync: syncStatus });
    }

    const report = await getUsageReport({
      range,
      granularity,
      project: projectParam || undefined,
      from: !isNaN(from as number) ? from : undefined,
      to: !isNaN(to as number) ? to : undefined,
      forceRefresh: forceRefresh && !syncing,
      skipSync: syncing || cold,
    });

    if (cache.size > 32) cache.clear();
    cache.set(cacheKey, { at: Date.now(), report });

    return NextResponse.json({ ...report, sync: syncStatus });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
