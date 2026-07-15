/**
 * services/database/hotelRepository.ts
 * ─────────────────────────────────────────────────────────────────
 * All hotel table access. Reads go through the search_hotels Postgres
 * function (FTS + trigram + filter ranking, fully parameterized).
 * Writes are upserts keyed on (external_id) or (hotel_name, city).
 */
import { getSupabase, type HotelRow, type SearchHotelsRpcRow } from "./supabase.js";
import type { SearchFilters } from "../search/filterSchema.js";
import { Errors } from "../../utils/errors.js";
import { getEnv } from "../../config/env.js";

export interface HotelUpsert {
  external_id: string | null;
  hotel_name: string;
  country: string | null;
  city: string | null;
  rating: number | null;
  rating_count: number | null;
  number_of_rooms: number | null;
  nearby_transit: string | null;
  nearby_landmarks: string | null;
  family_rooms: boolean | null;
  connected_rooms: boolean | null;
  facilities: string[];
  ai_summary: string | null;
  hotel_url: string | null;
  images: string[];
  search_keywords: string[];
  search_ranking_score: number | null;
  source_metadata: Record<string, unknown>;
}

export async function searchHotels(filters: SearchFilters): Promise<SearchHotelsRpcRow[]> {
  const env = getEnv();
  const { data, error } = await getSupabase().rpc("search_hotels", {
    p_country: filters.country,
    p_city: filters.city,
    p_hotel_name: filters.hotel_name,
    p_family_rooms: filters.family_rooms,
    p_connected_rooms: filters.connected_rooms,
    p_near_landmark: filters.near_landmark,
    p_near_transit: filters.near_transit,
    p_min_rating: filters.minimum_rating,
    p_min_reviews: filters.minimum_reviews,
    p_keywords: filters.keywords.length > 0 ? filters.keywords : null,
    p_limit: env.SEARCH_RESULT_LIMIT,
  });
  if (error) throw Errors.db("hotel search query failed", error);
  return (data ?? []) as SearchHotelsRpcRow[];
}

export async function upsertHotel(hotel: HotelUpsert): Promise<HotelRow> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const payload = { ...hotel, last_updated: now, updated_at: now };

  const { data, error } = await supabase
    .from("hotels")
    .upsert(payload, {
      onConflict: hotel.external_id ? "external_id" : "hotel_name,city",
      ignoreDuplicates: false,
    })
    .select()
    .single();

  if (error) throw Errors.db(`hotel upsert failed for "${hotel.hotel_name}"`, error);
  return data as HotelRow;
}

/** Hotels never enriched, or stale beyond `staleDays`. Used by refresh scheduling. */
export async function findStaleHotels(staleDays: number, limit: number): Promise<HotelRow[]> {
  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString();
  const { data, error } = await getSupabase()
    .from("hotels")
    .select("*")
    .or(`ai_summary.is.null,last_updated.lt.${cutoff}`)
    .order("last_updated", { ascending: true })
    .limit(limit);
  if (error) throw Errors.db("stale hotel lookup failed", error);
  return (data ?? []) as HotelRow[];
}
