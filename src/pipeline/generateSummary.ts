import { getGroqClient, GROQ_MODEL } from "../lib/groq";
import type { HotelEnrichment } from "../types/hotel";
import { logAudit, logError } from "../lib/logger";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

function sanitizeSummary(text: string): string {
  return text
    // Strip whole lines that are nothing but patch markers or fenced code delimiters
    .split("\n")
    .filter(line => !/^\*{3}|^```|^\s*\}\s*\*{3}/.test(line.trim()))
    .join(" ")
    // Strip inline patch markers that Groq appends mid/end-of-line
    // e.g. "...lovely hotel. *** End Patch```} ***!"
    .replace(/\*{3}\s*(?:Start|End)\s*Patch[^*]*/gi, "")
    // Strip any leftover *** sequences, stray backtick fences, stray } or !
    .replace(/\*{3,}/g, "")
    .replace(/```+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Extracts "retry after N ms" from a Groq 429 error message, defaults to 3000ms.
function parseRetryAfterMs(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/try again in ([0-9.]+)(ms|s)/i);
  if (!match) return 3_000;
  const value = parseFloat(match[1]);
  return match[2].toLowerCase() === "s" ? value * 1_000 : value;
}

export async function generateSummary(enrichment: HotelEnrichment): Promise<string | null> {
  const client = getGroqClient();
  const start = Date.now();

  try {
    const hotelName = enrichment.hotel_name;
    const city = enrichment.location;
    const reviewScore = enrichment.rating != null ? `${enrichment.rating}/10` : "";
    const roomTypes = [
      enrichment.family_detail ?? "",
      enrichment.connecting_detail ?? "",
    ].filter(Boolean).join("; ");
    const amenities = roomTypes; // best available amenity data we have
    const uniqueFeatures = ""; // reserved for future enrichment

    const userPrompt =
      `Write a 2-sentence hotel note for ${hotelName} in ${city}.\n\n` +
      `Use the following data points if available:\n` +
      `- Guest review score: ${reviewScore}\n` +
      `- Notable amenities: ${amenities}\n` +
      `- Room types: ${roomTypes}\n` +
      `- Any unique property features: ${uniqueFeatures}\n\n` +
      `Rules:\n` +
      `- Sentence 1: Lead with the hotel's most distinctive physical feature, history, or atmosphere. Be specific.\n` +
      `- Sentence 2: Name 2-3 concrete amenities or experiences, then close with who this hotel is for.\n` +
      `- Do not start with "This hotel" or "The hotel"\n` +
      `- Do not use the words: great, wonderful, perfect, ideal, amazing, excellent, fantastic, nice, good, suitable\n` +
      `- Maximum 55 words total\n` +
      `- Output the note only — no labels, no preamble, no quotation marks`;

    const completion = await client.chat.completions.create({
      model: GROQ_MODEL,
      max_tokens: 120,
      temperature: 0.75,
      messages: [
        {
          role: "system",
          content:
            "You are a hotel copywriter for a luxury travel agency. You write short, evocative hotel notes " +
            "that feel curated and personal — never generic. Your tone is warm, assured, and quietly persuasive. " +
            "You use specific physical and experiential details. You never use filler phrases like " +
            "\"great choice\", \"suitable for\", \"high rating\", or \"wonderful experience\".",
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    logAudit({
      timestamp: new Date().toISOString(),
      endpoint: GROQ_ENDPOINT,
      status: 200,
      durationMs: Date.now() - start,
      userId: "system",
    });

    const raw = completion.choices[0]?.message?.content ?? null;
    return raw ? sanitizeSummary(raw) : null;
  } catch (err) {
    // Retry once on 429 — Groq tells us exactly how long to wait
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429")) {
      const waitMs = parseRetryAfterMs(err);
      await new Promise((resolve) => setTimeout(resolve, waitMs + 200));
      try {
        const completion = await client.chat.completions.create({
          model: GROQ_MODEL,
          max_tokens: 120,
          temperature: 0.75,
          messages: [
            {
              role: "system",
              content:
                "You are a hotel copywriter for a luxury travel agency. You write short, evocative hotel notes " +
                "that feel curated and personal — never generic. Your tone is warm, assured, and quietly persuasive. " +
                "You use specific physical and experiential details. You never use filler phrases like " +
                "\"great choice\", \"suitable for\", \"high rating\", or \"wonderful experience\".",
            },
            {
              role: "user",
              content:
                `Write a 2-sentence hotel note for ${enrichment.hotel_name} in ${enrichment.location}.\n\n` +
                `Rules:\n- Sentence 1: Lead with the hotel's most distinctive physical feature or atmosphere.\n` +
                `- Sentence 2: Name 2-3 concrete amenities, then close with who this hotel is for.\n` +
                `- Do not start with "This hotel" or "The hotel"\n- Maximum 55 words total\n- Output the note only`,
            },
          ],
        });
        const raw = completion.choices[0]?.message?.content ?? null;
        return raw ? sanitizeSummary(raw) : null;
      } catch (retryErr) {
        logError("generateSummary.retry", GROQ_ENDPOINT, 0, retryErr);
        return null;
      }
    }
    logError("generateSummary", GROQ_ENDPOINT, 0, err);
    return null;
  }
}
