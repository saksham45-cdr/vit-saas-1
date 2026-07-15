/**
 * utils/sanitize.ts
 * ─────────────────────────────────────────────────────────────────
 * Hygiene for every string that crosses a trust boundary:
 *
 *  1. User queries → sent to LLM #1. Length-capped and control-char
 *     stripped; the LLM prompt wraps them in delimiters and instructs
 *     the model to treat the content strictly as data.
 *
 *  2. Web-scraped hotel data (DataForSEO) → sent to LLM #2. This is
 *     the classic indirect prompt-injection vector: a hotel page could
 *     contain "ignore previous instructions...". We strip common
 *     injection markers, cap lengths, and the summary prompt is built
 *     so scraped text is quoted data, never instructions.
 *
 *  3. Anything persisted → trimmed, capped, control chars removed.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Patterns commonly used to hijack an LLM via embedded instructions. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|previous|prior|above).{0,40}(instruction|prompt|rule)/gi,
  /disregard (all|any|previous|prior|above)/gi,
  /you are now/gi,
  /new instructions?:/gi,
  /system prompt/gi,
  /\bas an ai\b.{0,40}\b(model|assistant)\b/gi,
  /<\/?(system|assistant|instructions?)>/gi,
];

export function stripControlChars(input: string): string {
  return input.replace(CONTROL_CHARS, " ");
}

export function sanitizeUserQuery(input: string, maxLen = 500): string {
  return stripControlChars(input).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/** Neutralize instruction-like content in text scraped from the web. */
export function sanitizeScrapedText(input: string, maxLen = 4_000): string {
  let out = stripControlChars(input);
  for (const pattern of INJECTION_PATTERNS) out = out.replace(pattern, "[removed]");
  return out.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export function sanitizeForStorage(input: unknown, maxLen = 2_000): string | null {
  if (typeof input !== "string") return null;
  const cleaned = stripControlChars(input).trim().slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

export function clampNumber(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}
