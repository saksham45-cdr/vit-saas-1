import { getGroqClient, GROQ_MODEL } from "../lib/groq";
import { logError } from "../lib/logger";

export interface ParsedFilters {
  family_rooms?: boolean;
  // Future filters: min_rating, max_price, hotel_type, connected_rooms, etc.
}

export interface ParsedIntent {
  location: string | null;
  filters: ParsedFilters;
}

const SYSTEM_PROMPT =
  "You extract search intent from hotel queries. Return ONLY valid JSON — no explanation, no markdown, no text outside the JSON object.\n\n" +
  'Schema: { "location": string | null, "filters": { "family_rooms": boolean } }\n\n' +
  "Rules:\n" +
  "- location must be a real city, region, or country name. null if not mentioned or ambiguous.\n" +
  "- Never invent or guess locations. Extract only what is explicitly stated.\n" +
  "- family_rooms: true only if the user explicitly asks for family rooms, family-friendly, kids, or children.\n" +
  '- Return null for location if only a hotel type is mentioned with no place (e.g. "luxury hotels").';

export async function parseIntent(message: string): Promise<ParsedIntent> {
  try {
    const client = getGroqClient();

    const completion = await client.chat.completions.create({
      model: GROQ_MODEL,
      max_tokens: 80,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Query: ${message}` },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON in Groq response");

    const parsed = JSON.parse(match[0]) as {
      location?: string | null;
      filters?: { family_rooms?: boolean };
    };

    return {
      location:
        typeof parsed.location === "string"
          ? parsed.location.trim() || null
          : null,
      filters: {
        ...(parsed.filters?.family_rooms === true && { family_rooms: true }),
      },
    };
  } catch (err) {
    logError("parseIntent", "groq", 0, err);
    // Regex fallback — keeps the chatbot functional if Groq is unavailable
    return fallbackParse(message);
  }
}

function fallbackParse(message: string): ParsedIntent {
  return {
    location: extractLocation(message),
    filters: extractFilters(message),
  };
}

function extractLocation(message: string): string | null {
  const match = message.match(
    /\bin\s+([A-Za-z][A-Za-z\s]{1,40}?)(?:\s+(?:under|with|for|hotel|hotels|and|$)|\s*$)/i
  );
  if (match) return match[1].trim();
  return null;
}

function extractFilters(message: string): ParsedFilters {
  const lower = message.toLowerCase();
  const filters: ParsedFilters = {};
  if (lower.includes("family")) filters.family_rooms = true;
  return filters;
}
