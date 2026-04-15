# CLAUDE.md — Agent Context for Hotel Enrichment Pipeline

This file gives you (Claude) everything you need to work on this project without scanning the codebase from scratch each session.

---

## What This Project Does

A hotel enrichment pipeline + chatbot. It:
1. Fetches hotels from the VIT Travel API
2. Finds each hotel's Booking.com page via search (Serper → SerpAPI fallback)
3. Scrapes rating/review count using Playwright
4. Extracts room details (family rooms, connecting rooms, facilities, transit) via search
5. Generates an AI summary via Groq (LLaMA)
6. Stores results in Supabase
7. Exposes a `/api/chat` endpoint that answers natural-language hotel queries

---

## Tech Stack

| Layer | Tool |
|---|---|
| Runtime | Node.js + TypeScript |
| Deployment | Vercel (serverless functions) |
| Database | Supabase (Postgres + PostgREST) |
| Scraping | Playwright (headless Chromium) |
| Search | Serper.dev (primary) → SerpAPI (fallback) |
| AI | Groq API (LLaMA model) |
| Validation | Zod |

---

## Key Directory Structure

```
src/
  api/
    chat.ts              — POST /api/chat — public chatbot endpoint
  pipeline/
    runPipeline.ts       — orchestrates all 7 enrichment steps for one hotel
    runBatchPipeline.ts  — runs pipeline for a list (concurrency=3, cache-first)
    runAllHotels.ts      — full bulk run (guarded by ALLOW_BULK_RUN=true)
    fetchHotels.ts       — fetches hotel list from VIT API (paginated)
    searchGoogle.ts      — finds Booking.com URL via Serper/SerpAPI
    scrapeBooking.ts     — Playwright scrape of Booking.com page
    extractData.ts       — extracts structured data from scraped HTML
    fetchRoomData.ts     — searches for room/facility info (2 search calls)
    generateSummary.ts   — Groq AI summary generation
    saveResult.ts        — upserts enrichment to Supabase
    patchMissingFields.ts — backfills nulls on existing enrichments
    repairSummaries.ts   — regenerates bad/missing AI summaries
  chatbot/
    parseIntent.ts       — parses natural language → filters (location, family_rooms, etc.)
    searchHotels.ts      — queries Supabase for matching enrichments
    respond.ts           — formats the JSON response
  lib/
    supabase.ts          — Supabase client (service role, bypasses RLS)
    cache.ts             — isCacheFresh(): checks updated_at < 7 days
    groq.ts              — Groq client
    serpQuota.ts         — SerpAPI quota tracking (250/month free tier)
    serperQuota.ts       — Serper quota tracking (2,500/month; warn@2,000; stop@2,400)
    logger.ts            — logError() for server-side error logging
    envValidator.ts      — validates all required env vars on cold start
    pipelineCheckpoint.ts — saves/loads page+offset to resume mid-run
  middleware/
    auth.ts              — requireAuth(): x-api-key guard for internal routes
    rateLimiter.ts       — rate limiting for /api/chat
  services/
    apiService.ts        — secureGet() with URL allowlist
  types/
    hotel.ts             — Hotel, HotelEnrichment, ConnectingRoomsStatus interfaces
supabase/
  schema.sql             — full DB schema (source of truth)
.github/workflows/
  supabase-keep-alive.yml — pings DB every 3 days to prevent free-tier pause
```

---

## Database Schema (Supabase)

All tables have RLS enabled with NO policies — all access is via service role key (bypasses RLS).

| Table | Purpose |
|---|---|
| `hotels` | Raw hotel list (hotel_name, location) |
| `hotel_enrichments` | Enriched data. UNIQUE(hotel_name, location). Upserted on conflict. |
| `serp_usage` | SerpAPI call log for quota tracking |
| `serper_usage` | Serper.dev call log for quota tracking |
| `pipeline_checkpoint` | Single row (id=1): last_page + last_offset for resumable runs |

Cache TTL: `hotel_enrichments.updated_at` < 7 days = fresh, skip pipeline.

---

## Pipeline Flow (runPipeline.ts)

```
Hotel {name, location, country}
  → Step 1: findBookingUrl()       — Serper search → booking.com URL
  → Step 2+3 (parallel):
      scrapeBookingPage()          — Playwright → raw HTML
      fetchRoomData()              — 2 search calls → rooms/facilities/transit
  → Step 4: extractDataFromHtml()  — parse HTML → rating, rating_count
  → Step 5: merge roomData fields
  → Step 6: generateSummary()      — Groq AI → ai_summary string
  → Step 7: saveResult()           — upsert to hotel_enrichments
```

---

## API Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/chat` | POST | None (rate limited) | Public chatbot |
| Internal pipeline routes | Various | `x-api-key` header | Trigger enrichment runs |

Chat request body: `{ message: string }` (max 500 chars, validated by Zod)
Chat response: `{ reply: string, results: HotelEnrichment[] }`

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key (bypasses RLS) |
| `GROQ_API_KEY` | Yes | Groq API for AI summaries |
| `SERPER_API_KEY` | Yes | Serper.dev (primary search) |
| `SERP_API_KEY` | Yes | SerpAPI (fallback search) |
| `INTERNAL_API_KEY` | Optional | Protects pipeline routes; unset = open (dev) |
| `ALLOW_BULK_RUN` | Optional | Must be `true` to run full bulk pipeline |
| `VIT_HOTELS_API_URL` | Optional | Override VIT API base URL (must use https://) |
| `SERPER_USAGE_OFFSET` | Optional | Seed baseline for Serper quota tracking |
| `SERP_USAGE_OFFSET` | Optional | Seed baseline for SerpAPI quota tracking |
| `PLAYWRIGHT_HEADLESS` | Optional | Default true |

---

## Security Rules (non-negotiable)

- All external HTTP calls go through `secureGet()` in `apiService.ts` — URL allowlist enforced
- Never expose `SUPABASE_SERVICE_KEY` to the client
- `INTERNAL_API_KEY` guards all pipeline-trigger routes
- Quota hard stops: Serper at 2,400 calls, SerpAPI at 250 calls (per month)
- Rate limiting on `/api/chat` (see `middleware/rateLimiter.ts`)
- All env vars validated on cold start via `envValidator.ts`

---

## Known Patterns & Conventions

- Supabase client is always the **service role** client — never use anon key in backend
- `runBatchPipeline` runs 3 hotels concurrently (`CONCURRENCY = 3`) — don't raise without testing Playwright memory
- Pipeline checkpoint (single row, id=1) resets after 30 days of inactivity
- Search provider priority: Serper → SerpAPI (quota-gated, not random)
- All search calls are logged to `serp_usage` / `serper_usage` tables for quota tracking
- `saveResult` uses upsert on `UNIQUE(hotel_name, location)` — safe to re-run
