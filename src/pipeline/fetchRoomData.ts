import axios from "axios";
import { secureGet, ALLOWED_ENDPOINTS } from "../services/apiService";
import { getGroqClient, GROQ_MODEL } from "../lib/groq";
import { logAudit, logError } from "../lib/logger";
import { checkAndRecordSerpCall } from "../lib/serpQuota";
import type { ConnectingRoomsStatus } from "../types/hotel";

// OTA domains — snippets only, never fetch full page
const OTA_DOMAINS = new Set([
  "booking.com", "expedia.com", "agoda.com", "hotels.com",
  "tripadvisor.com", "kayak.com", "priceline.com", "orbitz.com",
  "hotelscombined.com", "trivago.com", "google.com",
]);

// Private IP ranges — block to prevent SSRF
const PRIVATE_IP_PATTERN =
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|::1|localhost)/i;

export interface RoomData {
  total_rooms: number | null;
  connecting_rooms: ConnectingRoomsStatus;
  connecting_detail: string;
  family_detail: string;
  sources: string[];
  confidence?: "low";
}

interface SerpResult {
  link: string;
  snippet?: string;
}

interface SerpApiResponse {
  organic_results?: SerpResult[];
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isOTA(domain: string): boolean {
  return Array.from(OTA_DOMAINS).some((ota) => domain.endsWith(ota));
}

// Fetch official hotel page with SSRF protection — never fetches OTAs or private IPs
async function fetchOfficialPage(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:") return null;
    if (PRIVATE_IP_PATTERN.test(parsed.hostname)) return null;
    if (isOTA(getDomain(url))) return null;

    const res = await axios.get<string>(url, {
      timeout: 8_000,
      maxRedirects: 3,
      maxContentLength: 500_000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html",
      },
    });

    const html: string = typeof res.data === "string" ? res.data : "";
    // Strip all tags to get plain text
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    // Find the most relevant section (keywords in priority order)
    const keywords = ["connecting room", "family room", "number of rooms", "total rooms", "accommodat", "faq"];
    let bestIdx = -1;
    for (const kw of keywords) {
      const idx = text.toLowerCase().indexOf(kw);
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx;
    }

    const start = Math.max(0, bestIdx === -1 ? 0 : bestIdx - 300);
    return text.slice(start, start + 4_000);
  } catch {
    return null;
  }
}

async function extractWithGroq(
  text: string,
  hotelName: string,
  city: string
): Promise<Partial<RoomData>> {
  const client = getGroqClient();
  const start = Date.now();

  const systemPrompt =
    "You are a data extractor. Return ONLY valid JSON — no explanation, no markdown, no text outside the JSON object.";

  const userPrompt = `Extract room information for "${hotelName}" in "${city}" from the text below.

Return this exact JSON structure:
{
  "total_rooms": <integer or null>,
  "connecting_rooms": <"yes" | "on request" | "no" | "unknown">,
  "connecting_detail": "<brief 1-sentence detail, empty string if unknown>",
  "family_detail": "<1 sentence about family rooms, empty string if unknown>"
}

Rules:
- connecting_rooms = "yes" if connecting/interconnecting/adjoining rooms are explicitly mentioned
- connecting_rooms = "on request" if only special requests or family/quad rooms with no explicit connecting type
- connecting_rooms = "no" only if a source explicitly states they are unavailable
- connecting_rooms = "unknown" if no mention found
- total_rooms must be a number found in the text — set null if not clearly stated

Text:
${text.slice(0, 3_000)}`;

  const tryExtract = async (prompt: string): Promise<Partial<RoomData>> => {
    const completion = await client.chat.completions.create({
      model: GROQ_MODEL,
      max_tokens: 200,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in response");
    return JSON.parse(match[0]) as Partial<RoomData>;
  };

  try {
    const result = await tryExtract(userPrompt);

    logAudit({
      timestamp: new Date().toISOString(),
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      status: 200,
      durationMs: Date.now() - start,
      userId: "system",
    });

    return result;
  } catch {
    // Retry once with a stricter minimal prompt
    try {
      const retryPrompt = `Return ONLY JSON. Extract from text:\n${text.slice(0, 1_500)}\n\nJSON keys: total_rooms (int|null), connecting_rooms (yes/on request/no/unknown), connecting_detail (str), family_detail (str)`;
      return await tryExtract(retryPrompt);
    } catch (err) {
      logError("fetchRoomData.groq", "https://api.groq.com/openai/v1/chat/completions", 0, err);
      return {};
    }
  }
}

// Runs 2 SerpAPI queries per hotel + optional official site fetch + Groq extraction.
// Costs 2 SerpAPI calls per uncached hotel (on top of the 1 from findBookingUrl).
export async function fetchRoomData(
  hotelName: string,
  location: string,
  country?: string
): Promise<RoomData> {
  const apiKey = process.env.SERP_API_KEY;
  const fullLocation = [location, country].filter(Boolean).join(", ");
  const sources: string[] = [];

  const defaultResult: RoomData = {
    total_rooms: null,
    connecting_rooms: "unknown",
    connecting_detail: "",
    family_detail: "",
    sources: [],
  };

  if (!apiKey) return defaultResult;

  let roomCountText = "";
  let connectingText = "";
  let officialUrl: string | null = null;

  // ── Query 1: Total room count ─────────────────────────────────────────────
  try {
    const q1Query = `${hotelName} ${fullLocation} total number of rooms`;
    const q1Allowed = await checkAndRecordSerpCall(q1Query);
    if (!q1Allowed) return { ...defaultResult, sources };

    const q1 = await secureGet<SerpApiResponse>(ALLOWED_ENDPOINTS.SERP_API, {
      q: q1Query,
      api_key: apiKey,
      num: 5,
    });

    if (!q1.organic_results?.length) {
      logError("fetchRoomData.q1", ALLOWED_ENDPOINTS.SERP_API, 0,
        new Error(`No results: ${hotelName} room count`));
    } else {
      for (const r of q1.organic_results) {
        const domain = getDomain(r.link);
        if (!isOTA(domain) && !officialUrl) officialUrl = r.link;
        if (r.snippet) { roomCountText += ` ${r.snippet}`; sources.push(domain); }
      }
    }
  } catch (err) {
    logError("fetchRoomData.q1", ALLOWED_ENDPOINTS.SERP_API, 0, err);
    return { ...defaultResult, sources };
  }

  // ── Query 2: Family/connecting room availability ──────────────────────────
  try {
    const q2Query = `${hotelName} ${fullLocation} connecting rooms family rooms availability`;
    const q2Allowed = await checkAndRecordSerpCall(q2Query);
    if (q2Allowed) {
      const q2 = await secureGet<SerpApiResponse>(ALLOWED_ENDPOINTS.SERP_API, {
        q: q2Query,
        api_key: apiKey,
        num: 5,
      });

      if (q2.organic_results?.length) {
        for (const r of q2.organic_results) {
          const domain = getDomain(r.link);
          if (!isOTA(domain) && !officialUrl) officialUrl = r.link;
          if (r.snippet) {
            connectingText += ` ${r.snippet}`;
            if (!sources.includes(domain)) sources.push(domain);
          }
        }
      }
    }
  } catch (err) {
    logError("fetchRoomData.q2", ALLOWED_ENDPOINTS.SERP_API, 0, err);
  }

  // ── Fetch official hotel website (if found, non-OTA) ─────────────────────
  let officialPageText = "";
  if (officialUrl) {
    const pageText = await fetchOfficialPage(officialUrl);
    if (pageText) {
      officialPageText = pageText;
      const domain = getDomain(officialUrl);
      if (!sources.includes(domain)) sources.unshift(domain); // highest trust — put first
    }
  }

  // ── Extract structured data via Groq ─────────────────────────────────────
  // Official page text first (highest trust), then snippets
  const combinedText = [officialPageText, roomCountText, connectingText]
    .filter(Boolean)
    .join("\n\n");

  if (!combinedText.trim()) return { ...defaultResult, sources };

  const extracted = await extractWithGroq(combinedText, hotelName, location);

  // Require 2+ sources to confirm total_rooms — otherwise mark low confidence
  const confidence =
    extracted.total_rooms != null && sources.length < 2 ? "low" : undefined;

  return {
    total_rooms: extracted.total_rooms ?? null,
    connecting_rooms: extracted.connecting_rooms ?? "unknown",
    connecting_detail: extracted.connecting_detail ?? "",
    family_detail: extracted.family_detail ?? "",
    sources,
    ...(confidence ? { confidence } : {}),
  };
}
