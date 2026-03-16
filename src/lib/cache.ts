import { getSupabaseClient } from "./supabase";

const CACHE_TTL_DAYS = 7;

export async function isCacheFresh(hotel_name: string, location: string): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("hotel_enrichments")
    .select("updated_at")
    .eq("hotel_name", hotel_name)
    .eq("location", location)
    .maybeSingle();

  if (error || !data || !data.updated_at) {
    return false;
  }

  const updatedAt = new Date(data.updated_at as string);
  const ageMs = Date.now() - updatedAt.getTime();
  const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

  return ageMs <= ttlMs;
}
