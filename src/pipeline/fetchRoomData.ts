import axios from "axios";
import { secureGet, securePost, ALLOWED_ENDPOINTS } from "../services/apiService";
import { getGroqClient, GROQ_MODEL } from "../lib/groq";
import { logAudit, logError } from "../lib/logger";
import { checkAndRecordSerperCall } from "../lib/serperQuota";
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
  facilities: string[];
  nearby_transit: string;
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

interface SerperResponse {
  organic?: SerpResult[];
}

// Runs a single search query — Serper primary, SerpAPI fallback.
// Returns organic results in a unified format.
async function searchQuery(query: string): Promise<SerpResult[]> {
  const serperKey = process.env.SERPER_API_KEY;
  if (serperKey) {
    const allowed = await checkAndRecordSerperCall(query);
    if (allowed) {
      try {
        const data = await securePost<SerperResponse>(
          ALLOWED_ENDPOINTS.SERPER_DEV,
          { q: query, num: 5 },
          serperKey
        );
        if (data.organic?.length) return data.organic;
      } catch {
        // Fall through to SerpAPI
      }
    }
  }

  // Fallback: SerpAPI
  const serpKey = process.env.SERP_API_KEY;
  if (!serpKey) return [];

  const allowed = await checkAndRecordSerpCall(query);
  if (!allowed) return [];

  const data = await secureGet<SerpApiResponse>(ALLOWED_ENDPOINTS.SERP_API, {
    q: query,
    api_key: serpKey,
    num: 5,
  });
  return data.organic_results ?? [];
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

  const userPrompt = `Extract hotel information for "${hotelName}" in "${city}" from the text below.

Return this exact JSON structure:
{
  "total_rooms": <integer or null>,
  "connecting_rooms": <"yes" | "on request" | "no" | "unknown">,
  "connecting_detail": "<brief 1-sentence detail, empty string if unknown>",
  "family_detail": "<1 sentence about family rooms, empty string if unknown>",
  "facilities": ["<facility1>", "<facility2>"],
  "nearby_transit": "<distances to metro/train/airport, empty string if unknown>"
}

Rules:
- connecting_rooms = "yes" if connecting/interconnecting/adjoining rooms are explicitly mentioned
- connecting_rooms = "on request" if only special requests or family/quad rooms with no explicit connecting type
- connecting_rooms = "no" only if a source explicitly states they are unavailable
- connecting_rooms = "unknown" if no mention found
- total_rooms must be a number found in the text — set null if not clearly stated
- facilities: list amenities found (e.g. Pool, Gym, Spa, Restaurant, Free WiFi, Parking, Bar); empty array if none mentioned
- nearby_transit: summarise distances as "Metro: Xkm, Train Station: Xkm, Airport: Xkm" — omit any not mentioned; empty string if none found

Text:
${text.slice(0, 3_500)}`;

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
      const retryPrompt = `Return ONLY JSON. Extract from text:\n${text.slice(0, 1_500)}\n\nJSON keys: total_rooms (int|null), connecting_rooms (yes/on request/no/unknown), connecting_detail (str), family_detail (str), facilities (string array), nearby_transit (str)`;
      return await tryExtract(retryPrompt);
    } catch (err) {
      logError("fetchRoomData.groq", "https://api.groq.com/openai/v1/chat/completions", 0, err);
      return {};
    }
  }
}

// Fetches ONLY facilities and nearby_transit for hotels that already have room data.
// Costs 2 search calls per hotel (Q3 + Q4). Used by the patch script.
export async function fetchMissingFields(
  hotelName: string,
  location: string,
  country?: string
): Promise<{ facilities: string[]; nearby_transit: string; city: string }> {
  const fullLocation = [location, country].filter(Boolean).join(", ");
  const empty = { facilities: [], nearby_transit: "", city: location };

  if (!process.env.SERPER_API_KEY && !process.env.SERP_API_KEY) return empty;

  let facilitiesText = "";
  let transitText = "";

  try {
    const q3 = await searchQuery(`${hotelName} ${fullLocation} hotel amenities facilities pool gym spa`);
    for (const r of q3) {
      if (r.snippet) facilitiesText += ` ${r.snippet}`;
    }
  } catch (err) {
    logError("fetchMissingFields.q3", "search", 0, err);
  }

  try {
    const q4 = await searchQuery(`${hotelName} ${fullLocation} distance metro train station airport`);
    for (const r of q4) {
      if (r.snippet) transitText += ` ${r.snippet}`;
    }
  } catch (err) {
    logError("fetchMissingFields.q4", "search", 0, err);
  }

  const combinedText = [facilitiesText, transitText].filter(Boolean).join("\n\n");
  if (!combinedText.trim()) return empty;

  const client = getGroqClient();
  const systemPrompt =
    "You are a data extractor. Return ONLY valid JSON — no explanation, no markdown, no text outside the JSON object.";
  const userPrompt =
    `Extract hotel info for "${hotelName}" in "${fullLocation}" from the text below.\n\n` +
    `Return this exact JSON:\n` +
    `{\n  "facilities": ["<facility1>", "<facility2>"],\n  "nearby_transit": "<distances summary, empty string if unknown>"\n}\n\n` +
    `Rules:\n` +
    `- facilities: list amenities found (Pool, Gym, Spa, Restaurant, Free WiFi, Parking, Bar, etc.); empty array if none\n` +
    `- nearby_transit: format as "Metro: Xkm, Train Station: Xkm, Airport: Xkm" — omit any not mentioned\n\n` +
    `Text:\n${combinedText.slice(0, 3_000)}`;

  try {
    const completion = await client.chat.completions.create({
      model: GROQ_MODEL,
      max_tokens: 200,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return empty;
    const parsed = JSON.parse(match[0]) as { facilities?: string[]; nearby_transit?: string };
    return {
      city: location,
      facilities: Array.isArray(parsed.facilities) ? parsed.facilities : [],
      nearby_transit: parsed.nearby_transit ?? "",
    };
  } catch (err) {
    logError("fetchMissingFields.groq", "https://api.groq.com/openai/v1/chat/completions", 0, err);
    return empty;
  }
}

// Runs 2 SerpAPI queries per hotel + optional official site fetch + Groq extraction.
// Costs 2 SerpAPI calls per uncached hotel (on top of the 1 from findBookingUrl).
export async function fetchRoomData(
  hotelName: string,
  location: string,
  country?: string
): Promise<RoomData> {
  const fullLocation = [location, country].filter(Boolean).join(", ");
  const sources: string[] = [];

  const defaultResult: RoomData = {
    total_rooms: null,
    connecting_rooms: "unknown",
    connecting_detail: "",
    family_detail: "",
    facilities: [],
    nearby_transit: "",
    sources: [],
  };

  // Require at least one search provider to be configured
  if (!process.env.SERPER_API_KEY && !process.env.SERP_API_KEY) return defaultResult;

  let roomsText = "";
  let facilitiesText = "";
  let transitText = "";
  let officialUrl: string | null = null;

  // ── Query 1: Room count + connecting/family availability (merged) ─────────
  // Combined query surfaces the same hotel-spec pages that mention both total
  // rooms and room-type details, so Groq can extract all four fields at once.
  try {
    const q1Results = await searchQuery(`${hotelName} ${fullLocation} total rooms connecting family rooms`);
    if (!q1Results.length) {
      logError("fetchRoomData.q1", "search", 0,
        new Error(`No results: ${hotelName} rooms`));
    } else {
      for (const r of q1Results) {
        const domain = getDomain(r.link);
        if (!isOTA(domain) && !officialUrl) officialUrl = r.link;
        if (r.snippet) { roomsText += ` ${r.snippet}`; sources.push(domain); }
      }
    }
  } catch (err) {
    logError("fetchRoomData.q1", "search", 0, err);
    return { ...defaultResult, sources };
  }

  // ── Query 2: Hotel facilities / amenities ─────────────────────────────────
  try {
    const q3Results = await searchQuery(`${hotelName} ${fullLocation} hotel amenities facilities pool gym spa`);
    for (const r of q3Results) {
      const domain = getDomain(r.link);
      if (!isOTA(domain) && !officialUrl) officialUrl = r.link;
      if (r.snippet) {
        facilitiesText += ` ${r.snippet}`;
        if (!sources.includes(domain)) sources.push(domain);
      }
    }
  } catch (err) {
    logError("fetchRoomData.q2", "search", 0, err);
  }

  // ── Query 3: Distance from metro / train station / airport ────────────────
  try {
    const q4Results = await searchQuery(`${hotelName} ${fullLocation} distance metro train station airport`);
    for (const r of q4Results) {
      const domain = getDomain(r.link);
      if (r.snippet) {
        transitText += ` ${r.snippet}`;
        if (!sources.includes(domain)) sources.push(domain);
      }
    }
  } catch (err) {
    logError("fetchRoomData.q3", "search", 0, err);
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
  const combinedText = [officialPageText, roomsText, facilitiesText, transitText]
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
    facilities: Array.isArray(extracted.facilities) ? extracted.facilities : [],
    nearby_transit: extracted.nearby_transit ?? "",
    sources,
    ...(confidence ? { confidence } : {}),
  };
}
