"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a finished turn's duration stays on screen. */
const DEFAULT_LINGER_MS = 2500;

interface RunClock {
  /** Epoch ms of the running turn, or null while idle. */
  startedAt: number | null;
  /** Duration in seconds of the turn that just ended; cleared after the linger. */
  finishedSeconds: number | null;
  /** Marks the current turn as user-aborted so it never reports a duration. */
  markAborted: () => void;
}

/**
 * Clock for the composer status row's stopwatch. It anchors to the turn's start
 * (so it does not reset while phases alternate) and hands back the finished
 * duration for the row's "done" beat, which lingers briefly and then clears.
 * An aborted turn reports nothing — aborting is not a completion.
 */
export function useRunClock(running: boolean, lingerMs = DEFAULT_LINGER_MS): RunClock {
  const startedAtRef = useRef<number | null>(null);
  const abortedRef = useRef(false);
  const [clock, setClock] = useState<{ startedAt: number | null; finishedSeconds: number | null }>({
    startedAt: null,
    finishedSeconds: null,
  });

  useEffect(() => {
    if (running) {
      const startedAt = startedAtRef.current ?? Date.now();
      startedAtRef.current = startedAt;
      setClock({ startedAt, finishedSeconds: null });
      return;
    }
    const startedAt = startedAtRef.current;
    if (startedAt === null) return;
    startedAtRef.current = null;
    if (abortedRef.current) {
      abortedRef.current = false;
      setClock({ startedAt: null, finishedSeconds: null });
      return;
    }
    setClock({ startedAt: null, finishedSeconds: (Date.now() - startedAt) / 1000 });
  }, [running]);

  useEffect(() => {
    if (clock.finishedSeconds === null) return undefined;
    const id = window.setTimeout(() => setClock({ startedAt: null, finishedSeconds: null }), lingerMs);
    return () => window.clearTimeout(id);
  }, [clock.finishedSeconds, lingerMs]);

  const markAborted = useCallback(() => {
    abortedRef.current = true;
  }, []);

  return { startedAt: clock.startedAt, finishedSeconds: clock.finishedSeconds, markAborted };
}
