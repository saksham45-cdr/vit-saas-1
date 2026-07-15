/**
 * api/health.ts → GET /api/health
 * Liveness + DB reachability probe. Public, unauthenticated, cheap.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildContext, requireMethod, sendError } from "../src/middleware/http.js";
import { getSupabase } from "../src/services/database/supabase.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const ctx = buildContext(req, res, "/api/health");
  try {
    requireMethod(req, "GET");
    const { error } = await getSupabase().from("hotels").select("id").limit(1);
    res.status(200).json({
      status: "ok",
      database: error ? "degraded" : "ok",
      ts: new Date().toISOString(),
    });
  } catch (err) {
    sendError(res, ctx, err);
  }
}
