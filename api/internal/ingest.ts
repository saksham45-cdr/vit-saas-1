/**
 * api/internal/ingest.ts → POST /api/internal/ingest
 * ─────────────────────────────────────────────────────────────────
 * Kicks off (or continues) an import: pulls one page from the client
 * hotel database and enqueues jobs. Call repeatedly with the returned
 * nextCursor to page through the whole catalog. Auth-protected.
 *
 * Body: { "cursor": string | null }
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import {
  buildContext,
  parseBody,
  requireInternalAuth,
  requireMethod,
  sendError,
} from "../../src/middleware/http.js";
import { enqueueFromClientDatabase } from "../../src/services/ingestion/ingestionService.js";

const BodySchema = z.object({
  cursor: z.string().max(500).nullable().optional().default(null),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const ctx = buildContext(req, res, "/api/internal/ingest");
  try {
    requireMethod(req, "POST");
    requireInternalAuth(req);
    const { cursor } = parseBody(req, BodySchema);

    const result = await enqueueFromClientDatabase(ctx.logger, cursor ?? null);
    res.status(202).json(result);
  } catch (err) {
    sendError(res, ctx, err);
  }
}
