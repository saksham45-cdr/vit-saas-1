/**
 * services/dataforseo/dataForSeoClient.ts
 * ─────────────────────────────────────────────────────────────────
 * DataForSEO Google Organic (live/advanced) client.
 * INGESTION-TIME ONLY — never imported by the search pipeline.
 *
 * Money safety:
 *   • assertWithinLimits("dataforseo") gates every call — warnings
 *     from $16, hard stop at $20 monthly estimated spend.
 *   • The API's own reported task cost is recorded when available,
 *     falling back to DATAFORSEO_COST_PER_TASK_USD so accounting can
 *     never silently under-count.
 *
 * Every scraped string is passed through sanitizeScrapedText before
 * it can ever reach LLM #2 (prompt-injection defense).
 */
import { getEnv } from "../../config/env.js";
import { Errors } from "../../utils/errors.js";
import { CircuitBreaker, retry } from "../../utils/resilience.js";
import { rootLogger, errToLog, type Logger } from "../../utils/logger.js";
import { getUsageMonitor } from "../monitoring/usageMonitor.js";
import { sanitizeScrapedText } from "../../utils/sanitize.js";

export interface OrganicResultItem {
  title: string;
  snippet: string;
  url: string;
  domain: string;
  ratingValue: number | null;
  ratingCount: number | null;
}

const breaker = new CircuitBreaker("dataforseo", 4, 60_000, rootLogger);

export async function googleOrganicSearch(
  query: string,
  logger: Logger,
): Promise<OrganicResultItem[]> {
  const env = getEnv();
  const log = logger.child({ module: "dataForSeo" });
  const monitor = getUsageMonitor();

  await monitor.assertWithinLimits("dataforseo");

  const auth = Buffer.from(
    `${env.DATAFORSEO_USERNAME}:${env.DATAFORSEO_PASSWORD}`,
  ).toString("base64");

  const started = Date.now();
  let retries = 0;

  try {
    const response = await breaker.exec(() =>
      retry(
        "dataforseo",
        async (signal) => {
          const res = await fetch(
            "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
            {
              method: "POST",
              signal,
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify([
                { keyword: query.slice(0, 200), language_code: "en", depth: 10 },
              ]),
            },
          );
          if (!res.ok) throw Errors.upstream("dataforseo", `HTTP ${res.status}`);
          return (await res.json()) as {
            cost?: number;
            tasks?: {
              cost?: number;
              result?: {
                items?: {
                  type?: string;
                  title?: string;
                  description?: string;
                  url?: string;
                  domain?: string;
                  rating?: { value?: number; votes_count?: number };
                }[];
              }[];
            }[];
          };
        },
        {
          attempts: 3,
          timeoutMs: 25_000,
          onRetry: (attempt, err) => {
            retries += 1;
            log.warn("dataforseo retrying", { attempt, ...errToLog(err) });
          },
        },
      ),
    );

    const latencyMs = Date.now() - started;
    const costUsd =
      response.cost ?? response.tasks?.[0]?.cost ?? env.DATAFORSEO_COST_PER_TASK_USD;

    await monitor.record("dataforseo", { success: true, latencyMs, retries, costUsd });

    const items = response.tasks?.[0]?.result?.[0]?.items ?? [];
    const organic = items
      .filter((i) => i.type === "organic" && (i.title || i.description))
      .map((i) => ({
        title: sanitizeScrapedText(i.title ?? "", 300),
        snippet: sanitizeScrapedText(i.description ?? "", 800),
        url: (i.url ?? "").slice(0, 500),
        domain: (i.domain ?? "").slice(0, 200),
        ratingValue: typeof i.rating?.value === "number" ? i.rating.value : null,
        ratingCount:
          typeof i.rating?.votes_count === "number" ? i.rating.votes_count : null,
      }));

    log.info("dataforseo ok", { latencyMs, items: organic.length, costUsd });
    return organic;
  } catch (err) {
    await monitor.record("dataforseo", {
      success: false,
      latencyMs: Date.now() - started,
      retries,
      costUsd: 0,
    });
    log.error("dataforseo failed", errToLog(err));
    throw err;
  }
}
