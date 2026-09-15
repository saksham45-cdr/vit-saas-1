/**
 * api/admin/run.ts → POST /api/admin/run  (start or step the pipeline)
 *                  → GET  /api/admin/run  (status + provider usage)
 * ─────────────────────────────────────────────────────────────────
 * All routes require a valid admin session cookie (HttpOnly, HMAC-signed).
 * The INTERNAL_API_SECRET is never returned to the browser.
 *
 * POST body — start a new run:
 *   { "action": "start", "count": <integer 1–500> }
 *
 * POST body — advance one step on an existing run:
 *   { "action": "step", "runId": "<uuid>" }
 *
 * GET — returns the most recent run's status + provider usage.
 *
 * "count" semantics: the number of hotels to enqueue from the client
 * hotel database. Phase 1 stops paginating once that many hotels have
 * been enqueued; Phase 2 stops claiming jobs once that many have been
 * processed. Hotels that fail enrichment remain in the queue for retry.
 *
 * One step = one enqueue page (Phase 1) or one worker batch of 1 hotel
 * (Phase 2). The browser calls POST { action: "step" } in a loop until
 * the returned run.status is no longer "running".
 *
 * Provider usage numbers are database-derived (from api_usage_daily)
 * and accurately reflect today's actual usage. They are labeled as such.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { buildContext, parseBody, sendError } from "../../src/middleware/http.js";
import { requireAdminSession } from "../../src/middleware/adminAuth.js";
import {
  createRun,
  stepRun,
  getLatestRun,
} from "../../src/services/admin/pipelineOrchestrator.js";

const PostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    count: z.coerce.number().int().min(1).max(500),
  }),
  z.object({
    action: z.literal("step"),
    runId: z.string().uuid(),
  }),
]);

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const ctx = buildContext(req, res, "/api/admin/run");
  try {
    requireAdminSession(req);

    if (req.method === "GET") {
      const result = await getLatestRun();
      res.status(200).json(result ?? { run: null, usage: {}, queueSnapshot: null });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: { code: "BAD_REQUEST", message: "Method not allowed" } });
      return;
    }

    const body = parseBody(req, PostSchema);

    if (body.action === "start") {
      ctx.logger.info("admin pipeline start", { count: body.count });
      const result = await createRun(body.count);
      res.status(201).json(result);
      return;
    }

    if (body.action === "step") {
      const result = await stepRun(body.runId);
      res.status(200).json(result);
      return;
    }
  } catch (err) {
    sendError(res, ctx, err);
  }
}
