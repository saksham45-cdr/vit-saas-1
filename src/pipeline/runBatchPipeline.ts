import { getSupabaseClient } from "../lib/supabase";
import { isCacheFresh } from "../lib/cache";
import { runPipeline } from "./runPipeline";
import type { Hotel, HotelEnrichment } from "../types/hotel";

// Max hotels to enrich concurrently. Keeps Playwright memory and API rate limits in check.
const CONCURRENCY = 3;

export interface BatchHotelResult {
  hotel_name: string;
  location: string;
  enrichment: HotelEnrichment | null;
  source: "cache" | "pipeline" | "error";
  error?: string;
}

// Processes a list of hotels: cache-first, pipeline fallback.
// Runs CONCURRENCY hotels in parallel, then the next batch, and so on.
export async function runBatchPipeline(hotels: Hotel[]): Promise<BatchHotelResult[]> {
  const results: BatchHotelResult[] = [];

  for (let i = 0; i < hotels.length; i += CONCURRENCY) {
    const chunk = hotels.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(processOneHotel));
    results.push(...chunkResults);
  }

  return results;
}

async function processOneHotel(hotel: Hotel): Promise<BatchHotelResult> {
  const { hotel_name, location } = hotel;

  try {
    // Check cache first
    const fresh = await isCacheFresh(hotel_name, location);

    if (fresh) {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("hotel_enrichments")
        .select("*")
        .eq("hotel_name", hotel_name)
        .eq("location", location)
        .maybeSingle();

      if (!error && data) {
        return { hotel_name, location, enrichment: data as HotelEnrichment, source: "cache" };
      }
    }

    // Cache miss or stale — run full pipeline
    const { enrichment, error } = await runPipeline(hotel);

    if (error || !enrichment) {
      return {
        hotel_name,
        location,
        enrichment: null,
        source: "error",
        error: error ?? "pipeline_failed"
      };
    }

    return { hotel_name, location, enrichment, source: "pipeline" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return { hotel_name, location, enrichment: null, source: "error", error: message };
  }
}
