/**
 * api/internal/ingest-worker.ts → POST or GET /api/internal/ingest-worker
 * ─────────────────────────────────────────────────────────────────
 * Background worker invocation. Triggered by the Vercel cron in
 * vercel.json (every 5 minutes) and manually with the internal secret.
 *
 * Each invocation claims one batch (FOR UPDATE SKIP LOCKED — safe to
 * run concurrently) and processes it sequentially. Halts immediately
 * if any provider hits its usage/cost limit.
 *
 * Auth: Vercel cron sends Authorization: Bearer $CRON_SECRET; we
 * accept either CRON_SECRET or INTERNAL_API_SECRET as the bearer.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildContext, sendError } from "../../src/middleware/http.js";
import { Errors } from "../../src/utils/errors.js";
import { getEnv } from "../../src/config/env.js";
import { runIngestionWorker } from "../../src/services/ingestion/ingestionService.js";

function authorize(req: VercelRequest): void {
  const header = req.headers.authorization ?? "";
  const accepted = [process.env.CRON_SECRET, getEnv().INTERNAL_API_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  if (accepted.length === 0 || !accepted.includes(header)) {
    throw Errors.unauthorized();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const ctx = buildContext(req, res, "/api/internal/ingest-worker");
  try {
    authorize(req);
    const result = await runIngestionWorker(ctx.logger, getEnv().INGEST_BATCH_SIZE);
    ctx.logger.info("worker pass finished", { ...result });
    res.status(200).json(result);
  } catch (err) {
    sendError(res, ctx, err);
  }
}
