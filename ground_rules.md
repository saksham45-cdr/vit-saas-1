# Hotel Enrichment Pipeline — Ground Rules

## 1. Data Integrity (Non-Negotiable)

- **Never fabricate data.** If a field cannot be extracted from a real web source, it must be set to `null`. No defaults, no guesses, no hallucinations.
- **Claude must only summarize.** The AI summary prompt must explicitly forbid Claude from adding facts not present in the extracted data object passed to it.
- **Source attribution is mandatory.** Every enriched record must include a `sources` array listing every URL data was pulled from.
- **Confidence scoring is required.** `extraction_confidence` must be computed programmatically (e.g. fields_found / total_fields). It must never be hardcoded or estimated by Claude.

---

## 2. Scraping Rules

- **Booking.com is the primary target.** Search queries must be structured as `"<hotel_name> <location> booking.com"` to maximize relevant hits.
- **20-second timeout is absolute.** Any Playwright session that exceeds 20 seconds must be aborted and the hotel record must be returned with whatever partial data was collected (nulls for missing fields).
- **JSON-LD / schema.org takes priority.** Structured metadata must be parsed before falling back to CSS selectors. This reduces brittleness and respects the site's intended data interface.
- **No login, no CAPTCHA solving.** The scraper must operate only on publicly accessible pages. Never attempt to bypass authentication or bot detection mechanisms.
- **Respect rate limits.** Add a minimum 2–3 second delay between successive scraping requests. Never run concurrent scrapers against the same domain.

---

## 3. Caching Rules

- **Cache TTL is 7 days.** A record with `updated_at` within the last 7 days must be returned from Supabase without triggering the pipeline.
- **Cache is checked first, always.** The chatbot layer must query Supabase before invoking any external service — no exceptions.
- **Pipeline is triggered on cache miss only.** Do not re-enrich a hotel unless the cache is stale or the record does not exist.
- **Partial results are cacheable.** A record with some `null` fields is still valid and should be cached. Incomplete ≠ invalid.

---

## 4. Claude API Usage

- **Model:** Always use `claude-sonnet-4-20250514` unless explicitly changed in config.
- **System prompt must include a hard constraint:** "Only describe the hotel using the data provided. Do not add, infer, or speculate about any detail not present in the input."
- **Input to Claude must be structured JSON.** Pass the extracted fields as a typed object, not a raw text blob scraped from the page.
- **Max tokens:** Cap the summary at 150 tokens. This is a short description, not a paragraph.
- **Do not send PII or session data to Claude.** The payload must contain only hotel metadata.

---

## 5. API & Backend Rules

- **All pipeline steps must be wrapped in try/catch.** Errors in one step (e.g. scraping) must not crash the entire pipeline — log the error and continue with nulls.
- **The `/api/chat` route must respond within 60 seconds.** Set Vercel function timeout to 60s. If the pipeline exceeds this, return a graceful degraded response.
- **Inputs must be validated.** Use Zod to validate all incoming API payloads. Never pass raw user input to Supabase queries or scraping functions.
- **SQL injection prevention.** Always use parameterized queries via the Supabase client. Never interpolate user strings into raw SQL.
- **Environment variables only.** API keys (Supabase, Anthropic, SerpAPI) must never be hardcoded or committed to version control.

---

## 6. Supabase Rules

- **Use `UPSERT` on `(hotel_name, location)`.** This ensures idempotency — re-running the pipeline never creates duplicate records.
- **Use the service key server-side only.** The Supabase service role key must never be exposed to the frontend or included in client bundles.
- **`updated_at` must be set explicitly on every write.** Do not rely on database defaults alone — set it in the application layer too.
- **Schema changes require a migration file.** Never alter the production schema via the Supabase dashboard without a corresponding versioned `.sql` migration file in the repo.

---

## 7. UI Rules

- **Light blue theme is the design baseline.** Primary color: `#E8F4FD`. Accent: `#2196F3`. No dark mode required for v1.
- **The UI must display the source of data** (cached vs. freshly enriched) in a subtle indicator on each message.
- **No user authentication for v1.** The chatbot is a single shared interface with no login.
- **No raw JSON in the chat UI.** All responses must be formatted as natural language by the chatbot layer before display.

---

## 8. Error Handling Hierarchy

| Scenario | Behavior |
|---|---|
| Scraper times out | Return partial data with nulls, log warning |
| Google search returns no booking.com URL | Set `booking_url: null`, skip scraping step |
| Claude API fails | Set `ai_summary: null`, do not retry automatically |
| Supabase write fails | Log error, return data to user anyway (don't swallow the response) |
| Pipeline exceeds 60s | Return cached data if available, else return `{ error: "enrichment_timeout" }` |

---

## 9. What Is Explicitly Forbidden

- Inventing hotel data of any kind
- Hardcoding API keys anywhere in the codebase
- Sending scraped raw HTML to Claude
- Bypassing the 7-day cache without a deliberate user-triggered refresh
- Running Playwright in non-headless mode in production
- Logging full HTTP responses that may contain user data
- Using `any` type in TypeScript — all types must be explicitly defined

---

## 10. Definition of Done (Per Hotel Record)

A hotel record is considered successfully enriched when:

1. `booking_url` is populated or confirmed not findable (`null`)
2. At least one of `rating` or `rating_count` is non-null
3. `ai_summary` is generated (or explicitly null if Claude failed)
4. `sources` contains at least one entry
5. `extraction_confidence` is a number between 0 and 1
6. Record is written to Supabase with a fresh `updated_at`
