import "dotenv/config";
import { fetchHotels } from "./fetchHotels";
import { runBatchPipeline } from "./runBatchPipeline";

// Pilot runner — enriches up to MAX_HOTELS hotels from the VIT API.
// Uses cache-first logic: already-enriched hotels are skipped automatically.
// Run: npx ts-node src/pipeline/runPilot.ts
//
// Quota cost (worst case, all uncached): MAX_HOTELS × 3 Serper calls
// 100 hotels = 300 Serper calls (12% of 2,500 free tier)

const MAX_HOTELS = 100;

async function runPilot(): Promise<void> {
  const collected: Awaited<ReturnType<typeof fetchHotels>>["hotels"] = [];
  let page = 1;

  console.log(`Fetching hotels from VIT API (up to ${MAX_HOTELS})...`);

  // Page through VIT API until we have enough hotels
  while (collected.length < MAX_HOTELS) {
    const { hotels, totalPages } = await fetchHotels(page);

    if (hotels.length === 0) break;

    collected.push(...hotels);
    console.log(`  Page ${page}/${totalPages} — ${collected.length} hotels collected`);

    if (page >= totalPages) break;
    page++;
  }

  const pilot = collected.slice(0, MAX_HOTELS);
  console.log(`\nRunning pipeline for ${pilot.length} hotels (concurrency: 3)...\n`);

  const results = await runBatchPipeline(pilot);

  const cached   = results.filter((r) => r.source === "cache").length;
  const enriched = results.filter((r) => r.source === "pipeline").length;
  const failed   = results.filter((r) => r.source === "error").length;

  console.log("\n── Pilot Run Summary ─────────────────────────");
  console.log(`  Total:    ${results.length}`);
  console.log(`  Enriched: ${enriched} (new pipeline run)`);
  console.log(`  Cached:   ${cached}  (already fresh, skipped)`);
  console.log(`  Failed:   ${failed}`);

  if (failed > 0) {
    console.log("\nFailed hotels:");
    results
      .filter((r) => r.source === "error")
      .forEach((r) => console.log(`  [${r.error}] ${r.hotel_name} — ${r.location}`));
  }

  console.log("──────────────────────────────────────────────");
}

runPilot().catch((err) => {
  console.error("Pilot run failed:", err);
  process.exit(1);
});
