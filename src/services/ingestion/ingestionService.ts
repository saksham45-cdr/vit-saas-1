/**
 * services/ingestion/ingestionService.ts
 * ─────────────────────────────────────────────────────────────────
 * PIPELINE 1 — Hotel Enrichment. Accuracy over speed.
 *
 *   Client hotel DB → enqueue jobs
 *   Worker (cron):  claim batch → per hotel:
 *     DataForSEO Google Organic → normalize → LLM #2 summary
 *     → upsert into Supabase (permanent record incl. summary)
 *
 * Internet access and LLM #2 exist ONLY in this module tree. The
 * search pipeline cannot reach them (no imports in that direction).
 */
import { fetchClientHotels } from "../client_api/clientHotelApi.js";
import { googleOrganicSearch } from "../dataforseo/dataForSeoClient.js";
import {
  normalizeHotelData,
  buildSearchKeywords,
  computeRankingScore,
} from "./normalizer.js";
import { generateHotelSummary } from "./summaryGenerator.js";
import { upsertHotel } from "../database/hotelRepository.js";
import { enqueueHotels, claimJobs, completeJob, failJob } from "./queue.js";
import { AppError } from "../../utils/errors.js";
import { errToLog, type Logger } from "../../utils/logger.js";
import type { ClientHotel } from "../client_api/clientHotelApi.js";

export interface EnqueueResult {
  fetched: number;
  enqueued: number;
  nextCursor: string | null;
}

/** Step 1 — pull a page of hotels from the client DB and queue them. */
export async function enqueueFromClientDatabase(
  logger: Logger,
  cursor: string | null,
): Promise<EnqueueResult> {
  const log = logger.child({ module: "ingestion", phase: "enqueue" });
  const page = await fetchClientHotels(log, cursor);
  const enqueued = await enqueueHotels(page.hotels);
  log.info("hotels enqueued", { fetched: page.hotels.length, enqueued });
  return { fetched: page.hotels.length, enqueued, nextCursor: page.nextCursor };
}

/** Enrich a single hotel end-to-end. Throws on failure (caller handles retry). */
async function enrichOne(seed: ClientHotel, logger: Logger): Promise<void> {
  const log = logger.child({ hotel: seed.hotelName, city: seed.city });
  const started = Date.now();

  // 1. Web evidence — the ONLY internet access in the whole system.
  const searchQuery = [seed.hotelName, seed.city, seed.country, "hotel"]
    .filter(Boolean)
    .join(" ");
  const serpItems = await googleOrganicSearch(searchQuery, log);

  // 2. Deterministic normalization.
  const normalized = normalizeHotelData(seed, serpItems);

  // 3. LLM #2 summary (null on failure — hotel is stored regardless).
  const aiSummary = await generateHotelSummary(normalized, log);

  // 4. Permanent storage.
  await upsertHotel({
    external_id: normalized.externalId,
    hotel_name: normalized.hotelName,
    country: normalized.country,
    city: normalized.city,
    rating: normalized.rating,
    rating_count: normalized.ratingCount,
    number_of_rooms: normalized.numberOfRooms,
    nearby_transit: normalized.nearbyTransit.join(", ") || null,
    nearby_landmarks: normalized.nearbyLandmarks.join(", ") || null,
    family_rooms: normalized.familyRooms,
    connected_rooms: normalized.connectedRooms,
    facilities: normalized.facilities,
    ai_summary: aiSummary,
    hotel_url: normalized.hotelUrl,
    images: [],
    search_keywords: buildSearchKeywords(normalized),
    search_ranking_score: computeRankingScore(normalized),
    source_metadata: {
      serp_result_count: serpItems.length,
      source_domains: normalized.sourceDomains,
      enriched_at: new Date().toISOString(),
      summary_generated: aiSummary !== null,
    },
  });

  log.info("hotel enriched", {
    latencyMs: Date.now() - started,
    hasSummary: aiSummary !== null,
    facilities: normalized.facilities.length,
  });
}

export interface WorkerResult {
  claimed: number;
  succeeded: number;
  failed: number;
  haltedBy: string | null; // set when a usage limit stopped the batch
}

/** Step 2 — worker pass: claim a batch and process sequentially.
 *  Sequential (not parallel) on purpose: ingestion values accuracy and
 *  budget safety over speed, and serial processing keeps DataForSEO
 *  spend perfectly monotonic against the $20 gate. */
export async function runIngestionWorker(logger: Logger, batchSize: number): Promise<WorkerResult> {
  const log = logger.child({ module: "ingestion", phase: "worker" });
  const jobs = await claimJobs(batchSize);
  log.info("worker batch claimed", { claimed: jobs.length });

  let succeeded = 0;
  let failed = 0;
  let haltedBy: string | null = null;

  for (const job of jobs) {
    try {
      await enrichOne(job.payload, log);
      await completeJob(job.id);
      succeeded += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      await failJob(job.id, job.attempts, message).catch((e) =>
        log.error("failJob update failed", errToLog(e)),
      );
      log.error("job failed", { jobId: job.id, attempts: job.attempts, ...errToLog(err) });

      // Budget/quota exhausted → stop the whole batch immediately;
      // remaining claimed jobs return to pending via their timeout.
      if (err instanceof AppError && err.code === "USAGE_LIMIT_REACHED") {
        haltedBy = (err.details?.provider as string) ?? "usage_limit";
        log.warn("worker halted by usage limit", { provider: haltedBy });
        break;
      }
    }
  }

  return { claimed: jobs.length, succeeded, failed, haltedBy };
}
