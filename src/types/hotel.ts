export interface Hotel {
  hotel_name: string;
  location: string;
  country: string;
}

export type ConnectingRoomsStatus = "yes" | "on request" | "no" | "unknown";

export interface HotelEnrichment {
  hotel_name: string;
  location: string;
  booking_url: string | null;
  rating: number | null;
  rating_count: number | null;
  number_of_rooms: number | null;
  family_rooms: boolean | null;
  family_detail: string | null;
  connected_rooms: boolean | null;
  connecting_rooms: ConnectingRoomsStatus | null;
  connecting_detail: string | null;
  ai_summary: string | null;
  sources: string[];
  extraction_confidence: number;
  updated_at: string;
}
