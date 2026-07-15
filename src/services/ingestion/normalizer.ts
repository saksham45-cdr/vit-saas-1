/**
 * services/ingestion/normalizer.ts
 * ─────────────────────────────────────────────────────────────────
 * Deterministic normalization of DataForSEO results into structured
 * hotel facts. Runs BEFORE LLM #2 so the model receives clean,
 * pre-extracted data and is used only for what LLMs are good at
 * (writing one factual summary) — not for parsing numbers out of
 * HTML soup, where regexes are cheaper and more reliable.
 */
import type { OrganicResultItem } from "../dataforseo/dataForSeoClient.js";
import type { ClientHotel } from "../client_api/clientHotelApi.js";
import { clampNumber } from "../../utils/sanitize.js";

export interface NormalizedHotel {
  externalId: string | null;
  hotelName: string;
  country: string | null;
  city: string | null;
  rating: number | null;
  ratingCount: number | null;
  numberOfRooms: number | null;
  nearbyTransit: string[];
  nearbyLandmarks: string[];
  familyRooms: boolean | null;
  connectedRooms: boolean | null;
  facilities: string[];
  hotelUrl: string | null;
  evidenceSnippets: string[]; // sanitized text fed to LLM #2
  sourceDomains: string[];
}

const FACILITY_PATTERNS: [RegExp, string][] = [
  [/free\s+wi-?fi|wireless internet/i, "Free WiFi"],
  [/swimming\s*pool|outdoor pool|indoor pool/i, "Pool"],
  [/\bspa\b/i, "Spa"],
  [/fitness|gym\b/i, "Fitness center"],
  [/\bparking\b/i, "Parking"],
  [/restaurant/i, "Restaurant"],
  [/\bbar\b/i, "Bar"],
  [/breakfast/i, "Breakfast"],
  [/airport shuttle|shuttle service/i, "Airport shuttle"],
  [/air.?conditioning|a\/c\b/i, "Air conditioning"],
  [/pet.?friendly|pets allowed/i, "Pet friendly"],
  [/business cent(er|re)|meeting room/i, "Business center"],
  [/room service/i, "Room service"],
  [/laundry/i, "Laundry"],
  [/concierge/i, "Concierge"],
];

const TRANSIT_PATTERN =
  /([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,3}\s+(?:metro|subway|underground|tube|train|tram|bus)\s+(?:station|stop)|(?:metro|train)\s+station\s+[A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,3})/g;

const LANDMARK_PATTERN =
  /(?:[Nn]ear|[Cc]lose to|[Ss]teps from|[Nn]ext to|[Oo]pposite|[Ww]alking distance (?:of|to|from))\s+(?:the\s+)?([A-Z][\w'’-]*(?:\s+(?:[A-Z][\w'’-]*|of|de|la|du|the)){0,4})/g;

const ROOMS_PATTERN = /(\d{1,4})\s*(?:guest\s*)?rooms?\b/i;

function dedupe(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase().trim();
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeHotelData(
  seed: ClientHotel,
  serpItems: OrganicResultItem[],
): NormalizedHotel {
  const allText = serpItems.map((i) => `${i.title}. ${i.snippet}`).join(" \n ");

  // Rating: prefer the highest-review-count structured SERP rating.
  const rated = serpItems
    .filter((i) => i.ratingValue !== null)
    .sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0));
  const rating = rated.length > 0 ? clampNumber(rated[0].ratingValue, 0, 10) : null;
  const ratingCount =
    rated.length > 0 && rated[0].ratingCount !== null
      ? Math.max(0, Math.floor(rated[0].ratingCount))
      : null;

  const roomsMatch = allText.match(ROOMS_PATTERN);
  const numberOfRooms = roomsMatch ? clampNumber(Number(roomsMatch[1]), 1, 9999) : null;

  const facilities = dedupe(
    FACILITY_PATTERNS.filter(([re]) => re.test(allText)).map(([, label]) => label),
    12,
  );

  const nearbyTransit = dedupe([...allText.matchAll(TRANSIT_PATTERN)].map((m) => m[1]), 4);
  const nearbyLandmarks = dedupe(
    [...allText.matchAll(LANDMARK_PATTERN)]
      .map((m) => m[1])
      .filter((l) => l.toLowerCase() !== seed.hotelName.toLowerCase()),
    5,
  );

  // Tri-state booleans: true when evidenced, null when unknown.
  // We never assert `false` from absence of evidence in a snippet.
  const familyRooms = /family (room|suite|friendly)|kids club|children'?s/i.test(allText)
    ? true
    : null;
  const connectedRooms = /connect(ed|ing)\s+(room|suite)|interconnect/i.test(allText)
    ? true
    : null;

  return {
    externalId: seed.externalId,
    hotelName: seed.hotelName,
    country: seed.country,
    city: seed.city,
    rating,
    ratingCount,
    numberOfRooms,
    nearbyTransit,
    nearbyLandmarks,
    familyRooms,
    connectedRooms,
    facilities,
    hotelUrl: seed.hotelUrl ?? serpItems.find((i) => i.url)?.url ?? null,
    evidenceSnippets: serpItems.slice(0, 6).map((i) => `${i.title}: ${i.snippet}`),
    sourceDomains: dedupe(serpItems.map((i) => i.domain), 8),
  };
}

/** Keywords stored per hotel to strengthen full-text matching. */
export function buildSearchKeywords(n: NormalizedHotel): string[] {
  const keywords = new Set<string>();
  for (const f of n.facilities) keywords.add(f.toLowerCase());
  if (n.familyRooms) {
    keywords.add("family");
    keywords.add("family rooms");
  }
  if (n.connectedRooms) keywords.add("connected rooms");
  for (const l of n.nearbyLandmarks) keywords.add(l.toLowerCase());
  for (const t of n.nearbyTransit) keywords.add(t.toLowerCase());
  if (n.city) keywords.add(n.city.toLowerCase());
  if (n.country) keywords.add(n.country.toLowerCase());
  return Array.from(keywords).slice(0, 40);
}

/**
 * Precomputed static quality score (stored as search_ranking_score).
 * Combined at query time with text relevance; computing the static
 * part at ingestion keeps the search query cheap.
 */
export function computeRankingScore(n: NormalizedHotel): number {
  const ratingComponent = n.rating !== null ? (Math.min(n.rating, 5) / 5) * 0.5 : 0.15;
  const reviewComponent =
    n.ratingCount !== null ? Math.min(Math.log10(n.ratingCount + 1) / 5, 1) * 0.3 : 0;
  const completeness =
    ([
      n.facilities.length > 0,
      n.nearbyTransit.length > 0,
      n.nearbyLandmarks.length > 0,
      n.numberOfRooms !== null,
    ].filter(Boolean).length /
      4) *
    0.2;
  return Number((ratingComponent + reviewComponent + completeness).toFixed(4));
}
