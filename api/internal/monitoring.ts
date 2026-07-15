/**
 * api/internal/monitoring.ts → GET /api/internal/monitoring
 * ─────────────────────────────────────────────────────────────────
 * Internal observability endpoint (Bearer INTERNAL_API_SECRET).
 * Exposes per-provider daily/monthly usage, estimated cost, failure
 * and retry counts, average latency, limit state, and queue depth.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildContext,
  requireInternalAuth,
  requireMethod,
  sendError,
} from "../../src/middleware/http.js";
import { getUsageMonitor } from "../../src/services/monitoring/usageMonitor.js";
import { queueDepth } from "../../src/services/ingestion/queue.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const ctx = buildContext(req, res, "/api/internal/monitoring");
  try {
    requireMethod(req, "GET");
    requireInternalAuth(req);

    const [usage, queue] = await Promise.all([
      getUsageMonitor().snapshot(),
      queueDepth().catch(() => null),
    ]);

    res.status(200).json({ generatedAt: new Date().toISOString(), usage, ingestionQueue: queue });
  } catch (err) {
    sendError(res, ctx, err);
  }
}
