/**
 * services/database/supabase.ts
 * ─────────────────────────────────────────────────────────────────
 * Supabase client singleton (service-role, server-side only).
 *
 * Architectural decision: every query goes through repositories or
 * Postgres functions (RPC) with bound parameters — no string-built
 * SQL anywhere, so SQL injection is structurally impossible from the
 * application layer.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "../../config/env.js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const env = getEnv();
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "hoteliq-backend" } },
  });
  return client;
}

/* ── Row types (mirror db/migrations) ────────────────────────── */

export interface HotelRow {
  id: string;
  external_id: string | null;
  hotel_name: string;
  country: string | null;
  city: string | null;
  rating: number | null;
  rating_count: number | null;
  number_of_rooms: number | null;
  nearby_transit: string | null;   // comma-separated, matches frontend contract
  nearby_landmarks: string | null; // comma-separated
  family_rooms: boolean | null;
  connected_rooms: boolean | null;
  facilities: string[] | null;
  ai_summary: string | null;
  hotel_url: string | null;
  images: string[] | null;
  search_keywords: string[] | null;
  search_ranking_score: number | null;
  source_metadata: Record<string, unknown> | null;
  last_updated: string;
  created_at: string;
  updated_at: string;
}

export interface SearchHotelsRpcRow extends HotelRow {
  match_rank: number;
}
