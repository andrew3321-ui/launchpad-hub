export interface SyncRunLike {
  status: "running" | "completed" | "failed";
  started_at: string;
  finished_at: string | null;
  processed_count: number;
  created_count: number;
  merged_count: number;
  error_count: number;
  skipped_count: number;
  last_error: string | null;
}

export const STALE_SYNC_ERROR_MESSAGE =
  "Rodada anterior marcada como interrompida porque excedeu o tempo esperado sem finalizar.";

const staleRunningThresholdMs = 1000 * 60 * 10;
const staleNoProgressThresholdMs = 1000 * 60 * 2;

export function getSyncRunAgeMs(run: Pick<SyncRunLike, "started_at">) {
  return Date.now() - new Date(run.started_at).getTime();
}

export function isSyncRunStale(run: SyncRunLike) {
  if (run.status !== "running") return false;

  const ageMs = getSyncRunAgeMs(run);
  const hasNoProgress =
    run.processed_count === 0 &&
    run.created_count === 0 &&
    run.merged_count === 0 &&
    run.error_count === 0 &&
    run.skipped_count === 0;

  if (hasNoProgress && ageMs >= staleNoProgressThresholdMs) {
    return true;
  }

  return ageMs >= staleRunningThresholdMs;
}

export function normalizeSyncRun<T extends SyncRunLike>(run: T): T {
  if (!isSyncRunStale(run)) return run;

  return {
    ...run,
    status: "failed",
    finished_at: run.finished_at || new Date().toISOString(),
    last_error: run.last_error || STALE_SYNC_ERROR_MESSAGE,
  } as T;
}
