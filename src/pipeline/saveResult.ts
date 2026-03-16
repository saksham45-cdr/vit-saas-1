import { getSupabaseClient } from "../lib/supabase";
import type { HotelEnrichment } from "../types/hotel";

export async function saveResult(enrichment: HotelEnrichment): Promise<void> {
  const supabase = getSupabaseClient();

  const payload = {
    ...enrichment,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from("hotel_enrichments")
    .upsert(payload, {
      onConflict: "hotel_name,location"
    });

  if (error) {
    throw error;
  }
}
