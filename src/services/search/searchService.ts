/**
 * services/search/searchService.ts
 * ─────────────────────────────────────────────────────────────────
 * PIPELINE 2 — User Search. Latency budget ≈ 500 ms.
 *
 *   User query
 *     → cache check (hit ⇒ 0 external calls, sub-10 ms)
 *     → LLM #1 (query → structured filters; validated; fallback)
 *     → search_hotels() Postgres function (indexed FTS + trigram)
 *     → deterministic reply string (NO second LLM call — the spec
 *       forbids AI generation after search, and it would blow the
 *       latency budget)
 *     → response in the exact shape the frontend renders.
 *
 * No internet access. No DataForSEO. Only pre-processed hotel data.
 */
import { parseUserQuery } from "./queryParser.js";
import { filtersAreEmpty, type SearchFilters } from "./filterSchema.js";
import { searchHotels } from "../database/hotelRepository.js";
import { TtlLruCache } from "./searchCache.js";
import type { Logger } from "../../utils/logger.js";

/** Response contract — field names consumed verbatim by chat.js. */
export interface HotelResult {
  hotel_name: string;
  city: string | null;
  country: string | null;
  location: string | null; // frontend fallback: fmtCity(h) = h.city || h.location
  rating: number | null;
  rating_count: number | null;
  number_of_rooms: number | null;
  family_rooms: boolean | null;
  connected_rooms: boolean | null;
  facilities: string[];
  nearby_transit: string | null; // comma-separated string (frontend splits on ", ")
  nearby_landmarks: string | null;
  ai_summary: string | null;
  hotel_url: string | null;
  images: string[];
}

export interface ChatSearchResponse {
  reply: string;
  results: HotelResult[];
}

const responseCache = new TtlLruCache<ChatSearchResponse>(300);

function describeFilters(f: SearchFilters, count: number): string {
  const parts: string[] = [];
  if (f.hotel_name) parts.push(`"${f.hotel_name}"`);
  if (f.family_rooms) parts.push("family-friendly");
  if (f.minimum_rating !== null) parts.push(`rated ${f.minimum_rating}+`);
  if (f.connected_rooms) parts.push("with connected rooms");
  const where = [f.city, f.country].filter(Boolean).join(", ");

  if (count === 0) {
    const scope = where ? ` in ${where}` : "";
    return `No hotels${scope} matched your search yet — coverage grows as more hotels are enriched. Try a nearby city or fewer filters.`;
  }
  const desc = parts.length ? `${parts.join(", ")} hotels` : "hotels";
  const scope = where ? ` in ${where}` : "";
  return `Found ${count} ${desc}${scope}, ranked by best match.`;
}

export async function runSearch(query: string, logger: Logger): Promise<ChatSearchResponse> {
  const log = logger.child({ module: "searchService" });
  const started = Date.now();

  // 1. Cache — repeated queries never touch the LLM or the DB.
  const cached = responseCache.get(query);
  if (cached) {
    log.info("search cache hit", { latencyMs: Date.now() - started });
    return cached;
  }

  // 2. Query intelligence (LLM #1, with validated output + fallback).
  const { filters, source } = await parseUserQuery(query, log);

  // 3. Empty signal → don't scan the table; return a guided reply.
  if (filtersAreEmpty(filters)) {
    return {
      reply:
        "I couldn't detect a hotel name, city, or preference in that. Try something like “family hotels in Barcelona” or a hotel name plus its city.",
      results: [],
    };
  }

  // 4. Indexed database search (single round-trip, ranked in SQL).
  const rows = await searchHotels(filters);

  const results: HotelResult[] = rows.map((r) => ({
    hotel_name: r.hotel_name,
    city: r.city,
    country: r.country,
    location: r.city, // compatibility alias for fmtCity()
    rating: r.rating !== null ? Number(r.rating) : null,
    rating_count: r.rating_count,
    number_of_rooms: r.number_of_rooms,
    family_rooms: r.family_rooms,
    connected_rooms: r.connected_rooms,
    facilities: r.facilities ?? [],
    nearby_transit: r.nearby_transit,
    nearby_landmarks: r.nearby_landmarks,
    ai_summary: r.ai_summary,
    hotel_url: r.hotel_url,
    images: r.images ?? [],
  }));

  const response: ChatSearchResponse = {
    reply: describeFilters(filters, results.length),
    results,
  };

  responseCache.set(query, response);

  log.info("search completed", {
    latencyMs: Date.now() - started,
    parseSource: source,
    resultCount: results.length,
    filters,
  });
  return response;
}
