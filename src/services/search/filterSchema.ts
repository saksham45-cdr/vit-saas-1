/**
 * services/search/filterSchema.ts
 * ─────────────────────────────────────────────────────────────────
 * The strict contract between LLM #1 and the search engine.
 * The model's raw output is NEVER trusted: it is JSON-parsed, then
 * zod-validated, then value-clamped. Anything failing validation
 * triggers exactly one retry, then the keyword-extraction fallback.
 */
import { z } from "zod";

const nullableTrimmedString = z
  .union([z.string(), z.null()])
  .transform((v) => {
    if (v === null) return null;
    const t = v.trim();
    return t.length === 0 ? null : t.slice(0, 120);
  });

export const SearchFiltersSchema = z
  .object({
    country: nullableTrimmedString.default(null),
    city: nullableTrimmedString.default(null),
    hotel_name: nullableTrimmedString.default(null),
    family_rooms: z.union([z.boolean(), z.null()]).default(null),
    connected_rooms: z.union([z.boolean(), z.null()]).default(null),
    near_landmark: nullableTrimmedString.default(null),
    near_transit: nullableTrimmedString.default(null),
    minimum_rating: z
      .union([z.number(), z.null()])
      .default(null)
      .transform((v) => (v === null ? null : Math.min(10, Math.max(0, v)))),
    minimum_reviews: z
      .union([z.number(), z.null()])
      .default(null)
      .transform((v) => (v === null ? null : Math.max(0, Math.floor(v)))),
    keywords: z
      .array(z.string())
      .default([])
      .transform((arr) =>
        arr
          .map((k) => k.trim().toLowerCase().slice(0, 60))
          .filter((k) => k.length > 0)
          .slice(0, 10),
      ),
  })
  .strip(); // drop any extra keys the model invents

export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export function emptyFilters(): SearchFilters {
  return SearchFiltersSchema.parse({});
}

/** True when the filters carry no usable signal at all. */
export function filtersAreEmpty(f: SearchFilters): boolean {
  return (
    !f.country &&
    !f.city &&
    !f.hotel_name &&
    f.family_rooms === null &&
    f.connected_rooms === null &&
    !f.near_landmark &&
    !f.near_transit &&
    f.minimum_rating === null &&
    f.minimum_reviews === null &&
    f.keywords.length === 0
  );
}
