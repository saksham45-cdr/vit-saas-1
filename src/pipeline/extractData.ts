import * as cheerio from "cheerio";
import type { HotelEnrichment } from "../types/hotel";

export function extractDataFromHtml(html: string, sourceUrl: string): HotelEnrichment {
  const $ = cheerio.load(html);

  let rating: number | null = null;
  let rating_count: number | null = null;
  // family_rooms, connected_rooms, number_of_rooms are now sourced from fetchRoomData (SerpAPI)
  // extractData only handles what Booking.com reliably exposes: rating + rating_count

  // ── Pass 1: JSON-LD (most reliable, least fragile) ───────────────────────
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = JSON.parse($(el).html() ?? "{}");
      const schemas: unknown[] = Array.isArray(raw) ? raw : [raw];

      for (const schema of schemas) {
        const s = schema as Record<string, unknown>;
        const type = s["@type"];
        if (type !== "Hotel" && type !== "LodgingBusiness") continue;

        const agg = s["aggregateRating"] as Record<string, unknown> | undefined;
        if (agg?.ratingValue != null && rating === null) {
          const v = parseFloat(String(agg.ratingValue));
          if (!isNaN(v)) rating = v;
        }
        if (agg?.reviewCount != null && rating_count === null) {
          const v = parseInt(String(agg.reviewCount), 10);
          if (!isNaN(v)) rating_count = v;
        }
        // numberOfRooms from JSON-LD is unreliable — sourced via SerpAPI instead
      }
    } catch {
      // malformed JSON-LD block — skip silently
    }
  });

  // ── Pass 2: CSS selector fallbacks ───────────────────────────────────────

  if (rating === null) {
    const candidates = [
      $('[data-testid="review-score-badge"]').first().text(),
      $('[data-testid="review-score"]').first().text(),
      $(".b5cd09854e").first().text(),
      $(".review-score-badge").first().text(),
    ];
    for (const text of candidates) {
      const v = parseFloat(text.trim().replace(",", "."));
      if (!isNaN(v) && v > 0 && v <= 10) {
        rating = v;
        break;
      }
    }
  }

  if (rating_count === null) {
    const candidates = [
      $('[data-testid="review-score-component"] span').last().text(),
      $('[data-testid="review-count"]').first().text(),
      $(".abf093bdfe").first().text(),
    ];
    for (const text of candidates) {
      const match = text.match(/[\d,]+/);
      if (match) {
        const v = parseInt(match[0].replace(/,/g, ""), 10);
        if (!isNaN(v)) {
          rating_count = v;
          break;
        }
      }
    }
  }

  // ── Confidence score — only rating fields from Booking.com ───────────────
  const scoredFields = [rating, rating_count];
  const found = scoredFields.filter((f) => f !== null).length;
  const extraction_confidence = Math.round((found / scoredFields.length) * 100) / 100;

  return {
    hotel_name: "",
    location: "",
    city: null,
    booking_url: sourceUrl,
    rating,
    rating_count,
    number_of_rooms: null,
    family_rooms: null,
    family_detail: null,
    connected_rooms: null,
    connecting_rooms: null,
    connecting_detail: null,
    facilities: null,
    nearby_transit: null,
    ai_summary: null,
    sources: [sourceUrl],
    extraction_confidence,
    updated_at: new Date().toISOString(),
  };
}
