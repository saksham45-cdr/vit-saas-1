// Finds a hotel's Booking.com URL via SerpAPI.
// All calls go through apiService (whitelisted endpoint, HTTPS enforced, audit-logged).
// The API key is passed as a query param — it is NOT logged (only the base endpoint is).
import { secureGet, ALLOWED_ENDPOINTS } from "../services/apiService";
import { checkAndRecordSerpCall } from "../lib/serpQuota";

interface SerpApiResponse {
  organic_results?: Array<{ link: string }>;
}

export async function findBookingUrl(
  hotel_name: string,
  location: string,
  country?: string
): Promise<string | null> {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return null;

  const query = [hotel_name, location, country, "site:booking.com"]
    .filter(Boolean)
    .join(" ");

  const allowed = await checkAndRecordSerpCall(query);
  if (!allowed) return null;

  const data = await secureGet<SerpApiResponse>(ALLOWED_ENDPOINTS.SERP_API, {
    q: query,
    api_key: apiKey,
    num: 1,
  });

  const firstLink = data.organic_results?.[0]?.link ?? null;

  if (firstLink && firstLink.includes("booking.com")) {
    return firstLink;
  }

  return null;
}
