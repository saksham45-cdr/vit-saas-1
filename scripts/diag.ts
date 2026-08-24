const secret = process.env.INTERNAL_API_SECRET ?? "";
if (secret.length < 16) process.env.INTERNAL_API_SECRET = secret.padEnd(16, "0");

const { getSupabase } = await import("../src/services/database/supabase.js");
const sb = getSupabase();

// Check what columns actually exist on the hotels table
const { data: cols, error: ce } = await sb.rpc("exec_sql" as never, {
  sql: "select column_name, data_type, is_nullable from information_schema.columns where table_name='hotels' order by ordinal_position"
} as never);
console.log("columns via rpc:", JSON.stringify({ cols, ce }));

// Plain insert test
const { data, error } = await sb
  .from("hotels")
  .insert({ hotel_name: "_test2", city: "_city2", external_id: "_ext2", country: null,
    rating: null, rating_count: null, number_of_rooms: null, nearby_transit: null,
    nearby_landmarks: null, family_rooms: null, connected_rooms: null, facilities: [],
    ai_summary: null, hotel_url: null, images: [], search_keywords: [],
    search_ranking_score: null, source_metadata: {},
    last_updated: new Date().toISOString(), updated_at: new Date().toISOString() })
  .select()
  .single();
console.log("INSERT test:", JSON.stringify({ data, error }, null, 2));

if (data?.id) await sb.from("hotels").delete().eq("id", data.id);
