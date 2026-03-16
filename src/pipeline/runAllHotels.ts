import { fetchHotels } from "./fetchHotels";
import { runBatchPipeline } from "./runBatchPipeline";

// Background enrichment job. Paginates the VIT hotels API and enriches each
// hotel (cache-first, pipeline fallback). Safe to re-run — hotels with a fresh
// cache entry are skipped automatically.
//
// ⚠️  SERP API QUOTA WARNING: Each uncached hotel costs 1 SerpAPI search.
//     Free tier = 250 searches/month. Do NOT run this job until you have
//     upgraded to a paid SerpAPI plan, or run it in small batches manually.
//
// Run manually:   npx ts-node src/pipeline/runAllHotels.ts
// Run via cron:   schedule this script nightly on any Node.js host (not Vercel)
export async function runAllHotels(): Promise<void> {
  // Hard guard — each hotel costs 3 SerpAPI calls (5000 hotels = 15,000 calls).
  // Must explicitly set ALLOW_BULK_RUN=true in .env to proceed.
  if (process.env.ALLOW_BULK_RUN !== "true") {
    throw new Error(
      "runAllHotels is disabled. Set ALLOW_BULK_RUN=true in .env to enable. " +
      "Warning: this consumes ~3 SerpAPI calls per uncached hotel."
    );
  }

  let page = 1;
  let totalPages = 1;
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;

  console.log("Starting enrichment run...");

  do {
    const { hotels, totalPages: tp, currentPage } = await fetchHotels(page);
    totalPages = tp;

    if (hotels.length === 0) break;

    const results = await runBatchPipeline(hotels);

    const succeeded = results.filter((r) => r.enrichment !== null).length;
    const failed = results.filter((r) => r.enrichment === null).length;

    totalProcessed += hotels.length;
    totalSucceeded += succeeded;
    totalFailed += failed;

    console.log(`[Page ${currentPage}/${totalPages}] batch: ${succeeded} ok, ${failed} failed`);

    page++;
  } while (page <= totalPages);

  console.log(`Done. ${totalProcessed} hotels — ${totalSucceeded} enriched, ${totalFailed} failed.`);
}

// Allows running directly: npx ts-node src/pipeline/runAllHotels.ts
if (require.main === module) {
  runAllHotels().catch((err) => {
    console.error("Enrichment run failed:", err);
    process.exit(1);
  });
}
