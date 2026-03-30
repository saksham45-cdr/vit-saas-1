/**
 * patchMissingFields.ts
 *
 * Targets cached hotels that are missing the new fields (city, facilities, nearby_transit).
 * Runs only 2 search queries per hotel (Q3 facilities + Q4 transit) — NOT a full re-enrichment.
 * Updates only the 3 new columns; all existing data is left untouched.
 *
 * Run with:
 *   npx ts-node src/pipeline/patchMissingFields.ts
 */

import "dotenv/config";
import { getSupabaseClient } from "../lib/supabase";
import { fetchMissingFields } from "./fetchRoomData";
import { logError } from "../lib/logger";

const BATCH_SIZE = 3; // concurrent patches per round

interface PartialHotel {
  hotel_name: string;
  location: string;
}

async function fetchUnpatched(): Promise<PartialHotel[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("hotel_enrichments")
    .select("hotel_name, location")
    .or("facilities.is.null,nearby_transit.is.null")
    .order("updated_at", { ascending: true }); // oldest first

  if (error) throw error;
  return (data ?? []) as PartialHotel[];
}

async function patchOne(hotel: PartialHotel): Promise<"ok" | "skip" | "error"> {
  try {
    const fields = await fetchMissingFields(hotel.hotel_name, hotel.location);

    // Only write back if we got something useful
    const payload: Record<string, unknown> = { city: fields.city };
    if (fields.facilities.length > 0) payload.facilities = fields.facilities;
    if (fields.nearby_transit) payload.nearby_transit = fields.nearby_transit;

    if (Object.keys(payload).length === 1 && payload.city) {
      // Only city — no new data found
      console.log(`  [skip] ${hotel.hotel_name} — no facilities/transit found`);
      return "skip";
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("hotel_enrichments")
      .update(payload)
      .eq("hotel_name", hotel.hotel_name)
      .eq("location", hotel.location);

    if (error) throw error;

    const parts = [];
    if (payload.facilities) parts.push(`facilities: [${(payload.facilities as string[]).join(", ")}]`);
    if (payload.nearby_transit) parts.push(`transit: ${payload.nearby_transit}`);
    console.log(`  [ok]   ${hotel.hotel_name} — ${parts.join(" | ")}`);
    return "ok";
  } catch (err) {
    logError("patchMissingFields", hotel.hotel_name, 0, err);
    console.error(`  [err]  ${hotel.hotel_name} — ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }
}

async function run() {
  console.log("Fetching hotels with missing fields...");
  const hotels = await fetchUnpatched();

  if (hotels.length === 0) {
    console.log("Nothing to patch — all hotels already have the new fields.");
    return;
  }

  console.log(`Found ${hotels.length} hotel(s) to patch.\n`);

  let ok = 0, skip = 0, errors = 0;

  for (let i = 0; i < hotels.length; i += BATCH_SIZE) {
    const batch = hotels.slice(i, i + BATCH_SIZE);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(hotels.length / BATCH_SIZE)}`);

    const results = await Promise.all(batch.map(patchOne));
    for (const r of results) {
      if (r === "ok") ok++;
      else if (r === "skip") skip++;
      else errors++;
    }
  }

  console.log(`\nDone. ok=${ok}  skip=${skip}  errors=${errors}`);
}

run().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
