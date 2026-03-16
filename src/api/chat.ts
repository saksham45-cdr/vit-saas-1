import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { parseIntent } from "../chatbot/parseIntent";
import { searchEnrichedHotels } from "../chatbot/searchHotels";
import { formatListResponse } from "../chatbot/respond";
import type { HotelEnrichment } from "../types/hotel";
import type { ParsedFilters } from "../chatbot/parseIntent";
import { rateLimit } from "../middleware/rateLimiter";
import { logError } from "../lib/logger";
import { validateEnv } from "../lib/envValidator";

// Validate all required env vars on cold start
validateEnv();

const bodySchema = z.object({
  message: z.string().min(1).max(500),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Rate limit before any processing
  if (!rateLimit(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  try {
    const { message } = bodySchema.parse(req.body);

    const intent = await parseIntent(message);

    if (!intent.location) {
      res.status(200).json({
        reply: "Please mention a city or country — for example: \"family hotels in Spain\" or \"hotels in Paris\".",
        results: [],
      });
      return;
    }

    const enrichments = await searchEnrichedHotels(intent.location);

    if (enrichments.length === 0) {
      res.status(200).json({
        reply: `No data found for "${intent.location}" yet. Our enrichment pipeline may not have processed this location.`,
        results: [],
      });
      return;
    }

    const filtered = applyFilters(enrichments, intent.filters);

    if (filtered.length === 0) {
      res.status(200).json({
        reply: `Found ${enrichments.length} hotel(s) in "${intent.location}" but none matched your specific requirements.`,
        results: [],
      });
      return;
    }

    res.status(200).json(formatListResponse(filtered, intent));
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }
    // Log full error server-side; return only a generic message to the client
    logError("chat.handler", "/api/chat", 500, error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function applyFilters(enrichments: HotelEnrichment[], filters: ParsedFilters): HotelEnrichment[] {
  return enrichments.filter((e) => {
    if (filters.family_rooms === true && !e.family_rooms) return false;
    return true;
  });
}
