/**
 * services/client_api/clientHotelApi.ts
 * ─────────────────────────────────────────────────────────────────
 * Adapter for the client's hotel database — the source of truth for
 * WHICH hotels exist. Everything downstream (DataForSEO, LLM #2) only
 * enriches records fetched here. Ingestion-time only.
 */
import { getEnv } from "../../config/env.js";
import { Errors } from "../../utils/errors.js";
import { retry } from "../../utils/resilience.js";
import { sanitizeForStorage } from "../../utils/sanitize.js";
import type { Logger } from "../../utils/logger.js";

export interface ClientHotel {
  externalId: string | null;
  hotelName: string;
  country: string | null;
  city: string | null;
  hotelUrl: string | null;
  raw: Record<string, unknown>;
}

interface FetchPage {
  hotels: ClientHotel[];
  nextCursor: string | null;
}

/** Map a raw client record into our normalized seed shape, defensively. */
function mapRecord(raw: Record<string, unknown>): ClientHotel | null {
  const name =
    sanitizeForStorage(raw["name"] ?? raw["hotel_name"] ?? raw["title"], 200);
  if (!name) return null;
  return {
    externalId: sanitizeForStorage(raw["id"] ?? raw["external_id"], 100),
    hotelName: name,
    country: sanitizeForStorage(raw["country"], 100),
    city: sanitizeForStorage(raw["city"] ?? raw["location"], 100),
    hotelUrl: sanitizeForStorage(raw["url"] ?? raw["website"], 500),
    raw,
  };
}

export async function fetchClientHotels(
  logger: Logger,
  cursor: string | null = null,
  pageSize = 50,
): Promise<FetchPage> {
  const env = getEnv();
  const log = logger.child({ module: "clientHotelApi" });

  const url = new URL(env.CLIENT_HOTEL_DATABASE_URL);
  url.searchParams.set("limit", String(pageSize));
  if (cursor) url.searchParams.set("cursor", cursor);

  const page = await retry(
    "client_hotel_api",
    async (signal) => {
      const res = await fetch(url, {
        signal,
        headers: {
          Authorization: `Bearer ${env.CLIENT_HOTEL_DATABASE_KEY}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        throw Errors.upstream("client_hotel_api", `HTTP ${res.status}`);
      }
      return (await res.json()) as {
        data?: Record<string, unknown>[];
        hotels?: Record<string, unknown>[];
        next_cursor?: string | null;
      };
    },
    { attempts: 3, timeoutMs: 15_000 },
  );

  const rawList = page.data ?? page.hotels ?? [];
  const hotels = rawList
    .map(mapRecord)
    .filter((h): h is ClientHotel => h !== null);

  log.info("client hotels fetched", { count: hotels.length, cursor });
  return { hotels, nextCursor: page.next_cursor ?? null };
}
