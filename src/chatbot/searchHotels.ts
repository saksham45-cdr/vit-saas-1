import { getSupabaseClient } from "../lib/supabase";
import type { HotelEnrichment } from "../types/hotel";

const HOTELS_PER_INTERACTION = 10;

// Prototype mode: reads directly from Supabase cache only.
// No VIT API calls, no SerpAPI, no Playwright — safe for Vercel serverless.
// To expand coverage, run runAllHotels.ts separately to seed more hotels.
export async function searchEnrichedHotels(
  location: string
): Promise<HotelEnrichment[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("hotel_enrichments")
    .select("*")
    .ilike("location", `%${location}%`)
    .limit(HOTELS_PER_INTERACTION);

  if (error) throw error;

  return (data ?? []) as HotelEnrichment[];
}
