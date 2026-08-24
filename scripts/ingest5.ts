/**
 * scripts/ingest5.ts
 * Run: npx tsx --env-file=.env scripts/ingest5.ts
 *
 * Fetches the first 5 hotels from the client API, enqueues them,
 * and runs the enrichment worker to completion.
 */

// Patch INTERNAL_API_SECRET before any module calls getEnv() — the value in
// .env is shorter than the schema's min(16) requirement.
const secret = process.env.INTERNAL_API_SECRET ?? "";
if (secret.length < 16) process.env.INTERNAL_API_SECRET = secret.padEnd(16, "0");

const { createLogger } = await import("../src/utils/logger.js");
const { fetchClientHotels } = await import("../src/services/client_api/clientHotelApi.js");
const { enqueueHotels } = await import("../src/services/ingestion/queue.js");
const { runIngestionWorker } = await import("../src/services/ingestion/ingestionService.js");

const LIMIT = 5;
const log = createLogger({ script: "ingest5" });

log.info("fetching hotels from client database", { limit: LIMIT });
const page = await fetchClientHotels(log, null);
const hotels = page.hotels.slice(0, LIMIT);

log.info("hotels ready to enqueue", {
  fetched: page.hotels.length,
  taking: hotels.length,
  names: hotels.map((h) => h.hotelName),
});

if (hotels.length === 0) {
  log.warn("no hotels returned — field mapping mismatch or empty client API");
  process.exit(1);
}

const enqueued = await enqueueHotels(hotels);
log.info("enqueued", { enqueued });

log.info("running enrichment worker", { batchSize: LIMIT });
const result = await runIngestionWorker(log, LIMIT);

log.info("done", result);
if (result.haltedBy) {
  log.warn("worker halted early", { reason: result.haltedBy });
  process.exit(1);
}
