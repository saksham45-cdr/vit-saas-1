import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url) throw new Error("Missing required env var: SUPABASE_URL");
  if (!key) throw new Error("Missing required env var: SUPABASE_SERVICE_KEY");

  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
