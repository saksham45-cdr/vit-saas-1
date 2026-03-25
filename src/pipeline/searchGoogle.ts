// Finds a hotel's Booking.com URL via search.
// Primary: Serper.dev (POST + X-API-KEY header).
// Fallback: SerpAPI (GET + api_key param) — used only when Serper quota is exhausted.
// All calls go through apiService (whitelisted endpoint, HTTPS enforced, audit-logged).
import { secureGet, securePost, ALLOWED_ENDPOINTS } from "../services/apiService";
import { checkAndRecordSerperCall } from "../lib/serperQuota";
import { checkAndRecordSerpCall } from "../lib/serpQuota";

interface SerperResponse {
  organic?: Array<{ link: string }>;
}

interface SerpApiResponse {
  organic_results?: Array<{ link: string }>;
}

function isBookingUrl(link: string): boolean {
  return link.includes("booking.com");
}

// Reject sitemaps, feeds, and non-HTML file extensions that Playwright can't render.
// e.g. booking.com/sitembk-hotel-ru.0018.xml.gz should never be scraped.
function isScrapablePage(link: string): boolean {
  const NON_HTML = /\.(xml|xml\.gz|gz|json|pdf|zip|csv|txt)([\?#]|$)/i;
  const SITEMAP = /sitemap|sitembk|\.xml/i;
  return !NON_HTML.test(link) && !SITEMAP.test(link);
}

export async function findBookingUrl(
  hotel_name: string,
  location: string,
  country?: string
): Promise<string | null> {
  const query = [hotel_name, location, country, "site:booking.com"]
    .filter(Boolean)
    .join(" ");

  // ── Primary: Serper.dev ───────────────────────────────────────────────────
  const serperKey = process.env.SERPER_API_KEY;
  if (serperKey) {
    const allowed = await checkAndRecordSerperCall(query);
    if (allowed) {
      try {
        const data = await securePost<SerperResponse>(
          ALLOWED_ENDPOINTS.SERPER_DEV,
          { q: query, num: 1 },
          serperKey
        );
        const link = data.organic?.[0]?.link ?? null;
        if (link && isBookingUrl(link) && isScrapablePage(link)) return link;
      } catch {
        // Fall through to SerpAPI backup
      }
    }
  }

  // ── Fallback: SerpAPI ─────────────────────────────────────────────────────
  const serpKey = process.env.SERP_API_KEY;
  if (!serpKey) return null;

  const allowed = await checkAndRecordSerpCall(query);
  if (!allowed) return null;

  const data = await secureGet<SerpApiResponse>(ALLOWED_ENDPOINTS.SERP_API, {
    q: query,
    api_key: serpKey,
    num: 1,
  });

  const link = data.organic_results?.[0]?.link ?? null;
  return link && isBookingUrl(link) && isScrapablePage(link) ? link : null;
}
