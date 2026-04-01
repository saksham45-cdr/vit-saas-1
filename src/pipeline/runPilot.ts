import "dotenv/config";
import { fetchHotels } from "./fetchHotels";
import { runBatchPipeline } from "./runBatchPipeline";
import { readCheckpoint, saveCheckpoint } from "../lib/pipelineCheckpoint";

// Pilot runner — resumes from the last saved checkpoint (page + offset within page).
// Paginates the VIT API until MAX_NEW_ENRICHMENTS fresh hotels are enriched.
// Cached hotels are skipped and don't count toward the target.
// Run: npx ts-node src/pipeline/runPilot.ts
//
// Quota cost (worst case): MAX_NEW_ENRICHMENTS × 4 Serper calls
// (1 findBookingUrl + 3 fetchRoomData: rooms, facilities, transit)
// 100 hotels = 400 Serper calls (16% of 2,500 free tier)
//
// Checkpoint resets automatically after 30 days (full re-scan for stale data).

const MAX_NEW_ENRICHMENTS = 100;
const BATCH_SIZE = 3; // matches CONCURRENCY in runBatchPipeline

async function runPilot(): Promise<void> {
  // ── Resume from last checkpoint ───────────────────────────────────────────
  const checkpoint = await readCheckpoint();
  let page = checkpoint.last_page;
  let pageStartOffset = checkpoint.last_offset;
  let totalPages = page; // updated on first fetch

  let newlyEnriched = 0;
  let totalCached   = 0;
  let totalFailed   = 0;
  const failedList: { name: string; location: string; error: string }[] = [];

  console.log(`Target: ${MAX_NEW_ENRICHMENTS} new enrichments (cached hotels skipped)...\n`);

  do {
    const { hotels, totalPages: tp } = await fetchHotels(page);
    totalPages = tp;

    if (hotels.length === 0) break;

    // Slice to resume mid-page if needed; subsequent pages always start at 0
    const pageHotels = pageStartOffset > 0 ? hotels.slice(pageStartOffset) : hotels;
    const displayOffset = pageStartOffset > 0 ? ` (resuming at hotel ${pageStartOffset + 1})` : "";
    console.log(`[Page ${page}/${totalPages}] processing ${pageHotels.length} hotels${displayOffset}...`);

    let batchEnriched = 0;
    let batchCached   = 0;
    let batchFailed   = 0;

    for (let i = 0; i < pageHotels.length; i += BATCH_SIZE) {
      const chunk = pageHotels.slice(i, i + BATCH_SIZE);
      const results = await runBatchPipeline(chunk);

      const chunkEnriched = results.filter((r) => r.source === "pipeline").length;
      const chunkCached   = results.filter((r) => r.source === "cache").length;
      const chunkFailed   = results.filter((r) => r.source === "error").length;

      batchEnriched += chunkEnriched;
      batchCached   += chunkCached;
      batchFailed   += chunkFailed;
      newlyEnriched += chunkEnriched;
      totalCached   += chunkCached;
      totalFailed   += chunkFailed;

      results
        .filter((r) => r.source === "error")
        .forEach((r) =>
          failedList.push({ name: r.hotel_name, location: r.location, error: r.error ?? "unknown" })
        );

      // ── Save checkpoint after every batch ──────────────────────────────────
      // If this batch completes the page, advance to the next page at offset 0.
      // Otherwise, save the current position within the page.
      const absoluteOffset = pageStartOffset + i + chunk.length;
      const pageComplete = absoluteOffset >= hotels.length;
      await saveCheckpoint(pageComplete ? page + 1 : page, pageComplete ? 0 : absoluteOffset);

      if (newlyEnriched >= MAX_NEW_ENRICHMENTS) {
        console.log(
          `  → enriched: ${batchEnriched}, cached: ${batchCached}, failed: ${batchFailed} | total new: ${newlyEnriched}/${MAX_NEW_ENRICHMENTS}`
        );
        printSummary(newlyEnriched, totalCached, totalFailed, failedList);
        return;
      }
    }

    console.log(
      `  → enriched: ${batchEnriched}, cached: ${batchCached}, failed: ${batchFailed} | total new: ${newlyEnriched}/${MAX_NEW_ENRICHMENTS}`
    );

    pageStartOffset = 0; // reset for all pages after the first
    page++;
  } while (page <= totalPages);

  printSummary(newlyEnriched, totalCached, totalFailed, failedList);
}

function printSummary(
  enriched: number,
  cached: number,
  failed: number,
  failedList: { name: string; location: string; error: string }[]
): void {
  console.log("\n── Pilot Run Summary ─────────────────────────");
  console.log(`  Newly enriched:   ${enriched}`);
  console.log(`  Cached (skipped): ${cached}`);
  console.log(`  Failed:           ${failed}`);

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
