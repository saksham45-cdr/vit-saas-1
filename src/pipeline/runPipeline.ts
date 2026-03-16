import type { Hotel, HotelEnrichment } from "../types/hotel";
import { findBookingUrl } from "./searchGoogle";
import { scrapeBookingPage } from "./scrapeBooking";
import { extractDataFromHtml } from "./extractData";
import { fetchRoomData } from "./fetchRoomData";
import { generateSummary } from "./generateSummary";
import { saveResult } from "./saveResult";

export interface PipelineResult {
  enrichment: HotelEnrichment | null;
  error?: string;
}

export async function runPipeline(hotel: Hotel): Promise<PipelineResult> {
  try {
    // Step 1: Find Booking.com URL (1 SerpAPI call)
    const bookingUrl = await findBookingUrl(hotel.hotel_name, hotel.location, hotel.country);

    if (!bookingUrl) {
      return { enrichment: null, error: "booking_url_not_found" };
    }

    // Step 2: Scrape Booking.com for rating + review count (Playwright)
    // Step 3: Fetch room data via 2 targeted SerpAPI queries + optional official site
    // Run both in parallel to save time
    const [scraped, roomData] = await Promise.all([
      scrapeBookingPage(bookingUrl),
      fetchRoomData(hotel.hotel_name, hotel.location, hotel.country),
    ]);

    if (!scraped) {
      return { enrichment: null, error: "scrape_failed" };
    }

    // Step 4: Extract rating/rating_count from Booking.com HTML
    const enrichment = extractDataFromHtml(scraped.html, bookingUrl);

    enrichment.hotel_name = hotel.hotel_name;
    enrichment.location = hotel.location;

    // Step 5: Merge room data from SerpAPI
    enrichment.number_of_rooms = roomData.total_rooms;
    enrichment.connecting_rooms = roomData.connecting_rooms;
    enrichment.connecting_detail = roomData.connecting_detail || null;
    enrichment.family_detail = roomData.family_detail || null;
    // Derive booleans for backward compatibility
    enrichment.family_rooms = roomData.family_detail.length > 0;
    enrichment.connected_rooms = roomData.connecting_rooms === "yes";
    // Merge sources (deduplicated)
    enrichment.sources = [...new Set([...enrichment.sources, ...roomData.sources])];

    // Step 6: Generate AI summary
    const summary = await generateSummary(enrichment);
    enrichment.ai_summary = summary;

    // Step 7: Save to Supabase
    await saveResult(enrichment);

    return { enrichment };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    return { enrichment: null, error: message };
  }
}
