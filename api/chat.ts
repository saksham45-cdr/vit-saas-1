/**
 * api/chat.ts → POST /api/chat
 * ─────────────────────────────────────────────────────────────────
 * The ONLY endpoint the frontend calls. Contract (preserved exactly):
 *
 *   Request:  { "message": string }
 *   Response: { "reply": string, "results": HotelResult[] }
 *
 * chat.js treats any non-2xx as a generic failure and renders
 * data.reply + data.results on success — both paths are honored.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import {
  buildContext,
  parseBody,
  rateLimit,
  requireMethod,
  sendError,
} from "../src/middleware/http.js";
import { runSearch } from "../src/services/search/searchService.js";

const BodySchema = z.object({
  message: z
    .string()
    .min(1, "message must not be empty")
    .max(500, "message too long (max 500 characters)"),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const ctx = buildContext(req, res, "/api/chat");
  const started = Date.now();

  try {
    requireMethod(req, "POST");
    rateLimit(req);
    const { message } = parseBody(req, BodySchema);

    const result = await runSearch(message, ctx.logger);

    ctx.logger.info("chat request served", {
      latencyMs: Date.now() - started,
      resultCount: result.results.length,
    });
    res.status(200).json(result);
  } catch (err) {
    sendError(res, ctx, err);
  }
}
