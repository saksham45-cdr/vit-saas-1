import "dotenv/config";
import { fetchHotels } from "./fetchHotels";
import { runBatchPipeline } from "./runBatchPipeline";

// Pilot runner — keeps paginating the VIT API until MAX_NEW_ENRICHMENTS fresh
// hotels are enriched (cached hotels are skipped and don't count toward the target).
// Run: npx ts-node src/pipeline/runPilot.ts
//
// Quota cost (worst case): MAX_NEW_ENRICHMENTS × 4 Serper calls
// (1 findBookingUrl + 3 fetchRoomData: rooms, facilities, transit)
// 200 hotels = 800 Serper calls (32% of 2,500 free tier)

const MAX_NEW_ENRICHMENTS = 200;

async function runPilot(): Promise<void> {
  let page = 1;
  let totalPages = 1;
  let newlyEnriched = 0;
  let totalCached = 0;
  let totalFailed = 0;
  const failedList: { name: string; location: string; error: string }[] = [];

  console.log(`Target: ${MAX_NEW_ENRICHMENTS} new enrichments (cached hotels skipped)...\n`);

  do {
    const { hotels, totalPages: tp } = await fetchHotels(page);
    totalPages = tp;

    if (hotels.length === 0) break;

    console.log(`[Page ${page}/${totalPages}] processing ${hotels.length} hotels...`);
    const results = await runBatchPipeline(hotels);

    const batchEnriched = results.filter((r) => r.source === "pipeline").length;
    const batchCached   = results.filter((r) => r.source === "cache").length;
    const batchFailed   = results.filter((r) => r.source === "error").length;

    newlyEnriched += batchEnriched;
    totalCached   += batchCached;
    totalFailed   += batchFailed;

    results
      .filter((r) => r.source === "error")
      .forEach((r) =>
        failedList.push({ name: r.hotel_name, location: r.location, error: r.error ?? "unknown" })
      );

    console.log(
      `  → enriched: ${batchEnriched}, cached: ${batchCached}, failed: ${batchFailed} | total new: ${newlyEnriched}/${MAX_NEW_ENRICHMENTS}`
    );

    if (newlyEnriched >= MAX_NEW_ENRICHMENTS) break;

    page++;
  } while (page <= totalPages);

  console.log("\n── Pilot Run Summary ─────────────────────────");
  console.log(`  Newly enriched: ${newlyEnriched}`);
  console.log(`  Cached (skipped): ${totalCached}`);
  console.log(`  Failed:           ${totalFailed}`);

  if (failedList.length > 0) {
    console.log("\nFailed hotels:");
    failedList.forEach((f) => console.log(`  [${f.error}] ${f.name} — ${f.location}`));
  }

  console.log("──────────────────────────────────────────────");
}

runPilot().catch((err) => {
  console.error("Pilot run failed:", err);
  process.exit(1);
});
