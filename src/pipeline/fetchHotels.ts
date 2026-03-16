import { secureGet, ALLOWED_ENDPOINTS } from "../services/apiService";
import type { AllowedEndpoint } from "../services/apiService";
import type { Hotel } from "../types/hotel";

interface VitHotelItem {
  hotelCode: string;
  hotelName: string;
  hotelRegion: string;
  hotelCity: string;
  hotelCountry: string;
}

interface VitApiResponse {
  status: number;
  total_pages: number;
  current_page_number: number;
  message: string;
  data: VitHotelItem[];
}

export interface HotelPage {
  hotels: Hotel[];
  totalPages: number;
  currentPage: number;
}

function getVitEndpoint(): AllowedEndpoint {
  return (
    (process.env.VIT_HOTELS_API_URL as AllowedEndpoint | undefined) ??
    ALLOWED_ENDPOINTS.VIT_HOTELS
  );
}

export async function fetchHotels(page = 1): Promise<HotelPage> {
  const response = await secureGet<VitApiResponse>(getVitEndpoint(), { page_number: page });

  const hotels: Hotel[] = response.data.map((item) => ({
    hotel_name: item.hotelName,
    location: item.hotelCity || item.hotelRegion,
    country: item.hotelCountry,
  }));

  return {
    hotels,
    totalPages: response.total_pages,
    currentPage: response.current_page_number,
  };
}

// Fetches hotels from VIT API matching a location/country query.
// Pages through the API and stops as soon as `limit` matches are found
// or `maxPages` is reached — keeping response times bounded.
export async function fetchHotelsByLocation(
  query: string,
  limit = 10,
  maxPages = 15
): Promise<Hotel[]> {
  const normalized = query.toLowerCase().trim();
  const matches: Hotel[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const { hotels, totalPages: tp } = await fetchHotels(page);
    totalPages = Math.min(tp, maxPages);

    for (const hotel of hotels) {
      const haystack = [hotel.hotel_name, hotel.location, hotel.country]
        .join(" ")
        .toLowerCase();

      if (haystack.includes(normalized)) {
        matches.push(hotel);
        if (matches.length >= limit) return matches;
      }
    }

    page++;
  } while (page <= totalPages);

  return matches;
}
