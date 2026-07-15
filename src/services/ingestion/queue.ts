/**
 * services/ingestion/queue.ts
 * ─────────────────────────────────────────────────────────────────
 * Postgres-backed job queue for hotel enrichment.
 *
 * Architectural decision: the queue lives in Supabase Postgres rather
 * than an external broker. Reasons:
 *   • zero extra infrastructure on Vercel,
 *   • claim_ingestion_jobs() uses FOR UPDATE SKIP LOCKED, so multiple
 *     concurrent workers (cron invocations) can never process the same
 *     job twice,
 *   • jobs, attempts and errors are durably visible for monitoring.
 *
 * Lifecycle: pending → processing → done | failed (with attempts and
 * scheduled exponential backoff on retryable failures).
 */
import { getSupabase } from "../database/supabase.js";
import { Errors } from "../../utils/errors.js";
import type { ClientHotel } from "../client_api/clientHotelApi.js";

export interface IngestionJob {
  id: string;
  payload: ClientHotel;
  attempts: number;
  status: "pending" | "processing" | "done" | "failed";
}

const MAX_ATTEMPTS = 3;

export async function enqueueHotels(hotels: ClientHotel[]): Promise<number> {
  if (hotels.length === 0) return 0;
  const rows = hotels.map((h) => ({
    dedupe_key: h.externalId ?? `${h.hotelName}|${h.city ?? ""}`.toLowerCase(),
    payload: h,
    status: "pending",
  }));
  const { error, count } = await getSupabase()
    .from("ingestion_jobs")
    .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true, count: "exact" });
  if (error) throw Errors.db("enqueue failed", error);
  return count ?? rows.length;
}

/** Atomically claim up to `limit` due jobs (SKIP LOCKED inside the RPC). */
export async function claimJobs(limit: number): Promise<IngestionJob[]> {
  const { data, error } = await getSupabase().rpc("claim_ingestion_jobs", {
    p_limit: limit,
  });
  if (error) throw Errors.db("job claim failed", error);
  return ((data ?? []) as { id: string; payload: ClientHotel; attempts: number }[]).map(
    (r) => ({ id: r.id, payload: r.payload, attempts: r.attempts, status: "processing" }),
  );
}

export async function completeJob(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("ingestion_jobs")
    .update({ status: "done", finished_at: new Date().toISOString(), last_error: null })
    .eq("id", id);
  if (error) throw Errors.db("job completion failed", error);
}

export async function failJob(id: string, attempts: number, message: string): Promise<void> {
  const exhausted = attempts >= MAX_ATTEMPTS;
  // Exponential backoff before the next worker run may claim it again.
  const retryAt = new Date(Date.now() + 2 ** attempts * 60_000).toISOString();
  const { error } = await getSupabase()
    .from("ingestion_jobs")
    .update({
      status: exhausted ? "failed" : "pending",
      last_error: message.slice(0, 1_000),
      run_after: exhausted ? null : retryAt,
      finished_at: exhausted ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw Errors.db("job failure update failed", error);
}

export async function queueDepth(): Promise<Record<string, number>> {
  const { data, error } = await getSupabase().rpc("ingestion_queue_depth");
  if (error) throw Errors.db("queue depth read failed", error);
  const out: Record<string, number> = { pending: 0, processing: 0, done: 0, failed: 0 };
  for (const row of (data ?? []) as { status: string; n: number }[]) out[row.status] = Number(row.n);
  return out;
}
