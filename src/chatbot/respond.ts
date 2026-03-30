import type { HotelEnrichment } from "../types/hotel";
import type { ParsedIntent } from "./parseIntent";

export interface HotelResult {
  hotel_name: string;
  location: string;
  city: string | null;
  rating: number | null;
  rating_count: number | null;
  number_of_rooms: number | null;
  family_rooms: boolean | null;
  connected_rooms: boolean | null;
  facilities: string[] | null;
  nearby_transit: string | null;
  ai_summary: string | null;
}

export interface ChatbotListReply {
  reply: string;
  results: HotelResult[];
}

export function formatListResponse(
  enrichments: HotelEnrichment[],
  intent: ParsedIntent
): ChatbotListReply {
  const results: HotelResult[] = enrichments.map(e => ({
    hotel_name: e.hotel_name,
    location: e.location,
    city: e.city ?? null,
    rating: e.rating,
    rating_count: e.rating_count,
    number_of_rooms: e.number_of_rooms,
    family_rooms: e.family_rooms,
    connected_rooms: e.connected_rooms,
    facilities: e.facilities ?? null,
    nearby_transit: e.nearby_transit ?? null,
    ai_summary: e.ai_summary,
  }));

  const locationText = intent.location ?? "the requested location";
  const count = results.length;
  const reply = `Found ${count} hotel${count !== 1 ? "s" : ""} in ${locationText}.`;

  return { reply, results };
}
