/**
 * services/admin/pipelineOrchestrator.ts
 * ─────────────────────────────────────────────────────────────────
 * Server-side orchestrator for manual hotel ingestion runs.
 *
 * Architecture: the browser drives iteration (calling /api/admin/run
 * repeatedly) but all privileged logic lives here. Each call executes
 * exactly ONE step — either one enqueue page or one worker batch of 1
 * hotel — so every invocation fits within the Vercel Hobby 10 s
 * function timeout.
 *
 * Hotel-count semantics: "requested_count" means hotels enqueued from
 * the client API into the ingestion queue. Phase 1 stops paginating
 * once enqueued_count >= requested_count. Phase 2 stops claiming once
 * claimed_count >= requested_count or the queue is empty.
 *
 * Concurrent-run protection: the table is checked for any run with
 * status='running' whose last_activity_at is < 15 min ago. Stale runs
 * (crashed / timed-out workers) are transparently superseded.
 */
import { getSupabase } from "../database/supabase.js";
import { getUsageMonitor } from "../monitoring/usageMonitor.js";
import { enqueueFromClientDatabase, runIngestionWorker } from "../ingestion/ingestionService.js";
import { queueDepth } from "../ingestion/queue.js";
import { Errors } from "../../utils/errors.js";
import { rootLogger } from "../../utils/logger.js";

export type RunStatus = "running" | "completed" | "partial" | "quota_halted" | "failed";
export type RunPhase = "enqueue" | "worker" | "done";

export interface PipelineRun {
  id: string;
  status: RunStatus;
  phase: RunPhase;
  requestedCount: number;
  enqueuedCount: number;
  claimedCount: number;
  succeededCount: number;
  failedCount: number;
  haltedBy: string | null;
  errorMessage: string | null;
  cursor: string | null;
  startedAt: string;
  lastActivityAt: string;
  finishedAt: string | null;
}

export interface StepResult {
  run: PipelineRun;
  usage: Record<string, unknown>;
  queueSnapshot: Record<string, number> | null;
}

/** A run is stale if its last_activity_at is older than this threshold. */
const STALE_RUN_MS = 15 * 60 * 1_000; // 15 minutes

function rowToRun(r: Record<string, unknown>): PipelineRun {
  return {
    id: r["id"] as string,
    status: r["status"] as RunStatus,
    phase: r["phase"] as RunPhase,
    requestedCount: Number(r["requested_count"]),
    enqueuedCount: Number(r["enqueued_count"]),
    claimedCount: Number(r["claimed_count"]),
    succeededCount: Number(r["succeeded_count"]),
    failedCount: Number(r["failed_count"]),
    haltedBy: (r["halted_by"] as string | null) ?? null,
    errorMessage: (r["error_message"] as string | null) ?? null,
    cursor: (r["cursor"] as string | null) ?? null,
    startedAt: r["started_at"] as string,
    lastActivityAt: r["last_activity_at"] as string,
    finishedAt: (r["finished_at"] as string | null) ?? null,
  };
}

async function getActiveRun(): Promise<PipelineRun | null> {
  const { data, error } = await getSupabase()
    .from("pipeline_runs")
    .select("*")
    .eq("status", "running")
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw Errors.db("Failed to check for active runs", error);
  if (!data) return null;
  const run = rowToRun(data as Record<string, unknown>);
  const age = Date.now() - new Date(run.lastActivityAt).getTime();
  // A stale run is one that hasn't been updated for 15 minutes — it
  // likely crashed mid-step. Allow a new run to start over it.
  return age < STALE_RUN_MS ? run : null;
}

/** Create a new pipeline run. Rejects if one is already active. */
export async function createRun(requestedCount: number): Promise<StepResult> {
  const existing = await getActiveRun();
  if (existing) {
    throw Errors.badRequest(
      `Run ${existing.id.slice(0, 8)}… is still active. ` +
        `Wait for it to finish or check status before starting a new one.`,
    );
  }

  const { data, error } = await getSupabase()
    .from("pipeline_runs")
    .insert({ requested_count: requestedCount, status: "running", phase: "enqueue" })
    .select("*")
    .single();
  if (error) throw Errors.db("Failed to create pipeline run", error);

  const run = rowToRun(data as Record<string, unknown>);
  const [usage, depth] = await Promise.all([
    getUsageMonitor().snapshot().catch(() => ({})),
    queueDepth().catch(() => null),
  ]);
  return { run, usage, queueSnapshot: depth };
}

/** Fetch the most recently started run (any status). */
export async function getLatestRun(): Promise<StepResult | null> {
  const { data, error } = await getSupabase()
    .from("pipeline_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw Errors.db("Failed to fetch latest run", error);
  if (!data) return null;

  const run = rowToRun(data as Record<string, unknown>);
  const [usage, depth] = await Promise.all([
    getUsageMonitor().snapshot().catch(() => ({})),
    queueDepth().catch(() => null),
  ]);
  return { run, usage, queueSnapshot: depth };
}

async function patchRun(id: string, patch: Record<string, unknown>): Promise<PipelineRun> {
  const { data, error } = await getSupabase()
    .from("pipeline_runs")
    .update({ ...patch, last_activity_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw Errors.db("Failed to update pipeline run", error);
  return rowToRun(data as Record<string, unknown>);
}

/**
 * Advance the pipeline by one step and return the updated state.
 *
 * Phase "enqueue":
 *   Fetches one page of hotels from the client API and enqueues them.
 *   Stops (transitions to "worker") once enqueued_count >= requested_count
 *   or the client API has no more pages.
 *
 * Phase "worker":
 *   Processes one hotel (batchSize=1) from the queue.
 *   Stops when claimed_count >= requested_count or the queue is empty.
 *   Halts immediately if a provider quota is exhausted.
 */
export async function stepRun(runId: string): Promise<StepResult> {
  const log = rootLogger.child({ module: "pipelineOrchestrator", runId });

  // Re-fetch the run to get the authoritative current state.
  const { data: raw, error: fetchErr } = await getSupabase()
    .from("pipeline_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (fetchErr || !raw) throw Errors.db("Run not found", fetchErr ?? undefined);

  let run = rowToRun(raw as Record<string, unknown>);

  // If already finished (e.g., a duplicate step call), just return.
  if (run.status !== "running") {
    const [usage, depth] = await Promise.all([
      getUsageMonitor().snapshot().catch(() => ({})),
      queueDepth().catch(() => null),
    ]);
    return { run, usage, queueSnapshot: depth };
  }

  // ── Phase 1: Enqueue ──────────────────────────────────────────
  if (run.phase === "enqueue") {
    if (run.enqueuedCount >= run.requestedCount) {
      // Already at the limit — skip straight to worker phase.
      run = await patchRun(runId, { phase: "worker", cursor: null });
    } else {
      try {
        const result = await enqueueFromClientDatabase(log, run.cursor ?? null);
        const newEnqueued = run.enqueuedCount + result.enqueued;
        const limitReached = newEnqueued >= run.requestedCount;
        const pagesExhausted = result.nextCursor === null;
        const transitionToWorker = limitReached || pagesExhausted;

        run = await patchRun(runId, {
          enqueued_count: newEnqueued,
          cursor: transitionToWorker ? null : result.nextCursor,
          phase: transitionToWorker ? "worker" : "enqueue",
        });

        log.info("enqueue step complete", {
          fetched: result.fetched,
          enqueued: result.enqueued,
          totalEnqueued: newEnqueued,
          requested: run.requestedCount,
          limitReached,
          pagesExhausted,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("enqueue step failed", { err: msg });
        run = await patchRun(runId, {
          status: "failed",
          phase: "done",
          error_message: `Enqueue failed: ${msg.slice(0, 500)}`,
          finished_at: new Date().toISOString(),
        });
      }
    }
  // ── Phase 2: Worker ───────────────────────────────────────────
  } else if (run.phase === "worker") {
    const remainingQuota = run.requestedCount - run.claimedCount;

    if (remainingQuota <= 0) {
      // We've processed our requested count — wrap up.
      const finalStatus: RunStatus = run.failedCount > 0 ? "partial" : "completed";
      run = await patchRun(runId, {
        status: finalStatus,
        phase: "done",
        finished_at: new Date().toISOString(),
      });
    } else {
      try {
        // batchSize=1 keeps each invocation within the 10s Vercel timeout.
        // DataForSEO + Groq for one hotel is typically 3–8 s.
        const result = await runIngestionWorker(log, 1);
        const newClaimed = run.claimedCount + result.claimed;
        const newSucceeded = run.succeededCount + result.succeeded;
        const newFailed = run.failedCount + result.failed;

        log.info("worker step complete", {
          claimed: result.claimed,
          succeeded: result.succeeded,
          failed: result.failed,
          haltedBy: result.haltedBy,
          totalClaimed: newClaimed,
        });

        if (result.haltedBy !== null) {
          // Provider quota exhausted — halt the entire run.
          run = await patchRun(runId, {
            status: "quota_halted",
            phase: "done",
            claimed_count: newClaimed,
            succeeded_count: newSucceeded,
            failed_count: newFailed,
            halted_by: result.haltedBy,
            error_message: `Pipeline stopped: ${result.haltedBy} reached its quota limit.`,
            finished_at: new Date().toISOString(),
          });
        } else if (result.claimed === 0) {
          // Queue is empty — nothing more to process.
          const finalStatus: RunStatus = newFailed > 0 ? "partial" : "completed";
          run = await patchRun(runId, {
            status: finalStatus,
            phase: "done",
            claimed_count: newClaimed,
            succeeded_count: newSucceeded,
            failed_count: newFailed,
            finished_at: new Date().toISOString(),
          });
        } else {
          const limitReached = newClaimed >= run.requestedCount;
          const patch: Record<string, unknown> = {
            claimed_count: newClaimed,
            succeeded_count: newSucceeded,
            failed_count: newFailed,
          };
          if (limitReached) {
            patch["status"] = newFailed > 0 ? "partial" : "completed";
            patch["phase"] = "done";
            patch["finished_at"] = new Date().toISOString();
          }
          run = await patchRun(runId, patch);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("worker step failed", { err: msg });
        run = await patchRun(runId, {
          status: "failed",
          phase: "done",
          error_message: `Worker failed: ${msg.slice(0, 500)}`,
          finished_at: new Date().toISOString(),
        });
      }
    }
  }

  const [usage, depth] = await Promise.all([
    getUsageMonitor().snapshot().catch(() => ({})),
    queueDepth().catch(() => null),
  ]);
  return { run, usage, queueSnapshot: depth };
}
