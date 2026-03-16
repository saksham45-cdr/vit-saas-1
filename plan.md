# Hotel Enrichment Pipeline — Project Plan

## Overview
A production-grade SaaS backend that enriches hotel records using web scraping and AI-generated summaries, served via a chatbot UI.

---

## Folder Structure

```
hotel-enrichment/
├── src/
│   ├── pipeline/
│   │   ├── fetchHotels.ts          # Pull hotel records from Supabase
│   │   ├── searchGoogle.ts         # Google search → booking.com URL discovery
│   │   ├── scrapeBooking.ts        # Playwright scraper for booking.com pages
│   │   ├── extractData.ts          # Parse JSON-LD / schema.org + fallback selectors
│   │   ├── generateSummary.ts      # Claude API integration → ai_summary
│   │   ├── saveResult.ts           # Upsert enriched record into Supabase
│   │   └── runPipeline.ts          # Orchestrator — ties all steps together
│   ├── chatbot/
│   │   ├── query.ts                # Supabase-first lookup with pipeline fallback
│   │   └── respond.ts              # Format chatbot response
│   ├── api/
│   │   └── chat.ts                 # Vercel API route: POST /api/chat
│   ├── lib/
│   │   ├── supabase.ts             # Supabase client singleton
│   │   ├── claude.ts               # Anthropic client singleton
│   │   └── cache.ts                # 7-day cache logic (Supabase updated_at check)
│   └── types/
│       └── hotel.ts                # TypeScript interfaces
├── ui/
│   ├── index.html                  # Simple chatbot UI (light blue theme)
│   ├── chat.js                     # Frontend logic
│   └── style.css                   # Light blue styling
├── supabase/
│   └── schema.sql                  # Table definitions + indexes
├── .env.example
├── vercel.json
├── package.json
└── tsconfig.json
```

---

## Phase Breakdown

### Phase 1 — Database & Schema
- Create `hotels` table in Supabase (see schema.sql)
- Create `hotel_enrichments` table for enriched output
- Add indexes on `hotel_name`, `location`, `updated_at`
- Seed with existing hotel records (name + location only)

### Phase 2 — Web Discovery
- `searchGoogle.ts`: Use SerpAPI or Axios + cheerio against Google search
- Query pattern: `"<hotel_name> <location> booking.com"`
- Extract first booking.com result URL
- Fallback: direct booking.com search URL construction

### Phase 3 — Scraping & Extraction
- `scrapeBooking.ts`: Launch Playwright (headless Chromium)
- Timeout: 20 seconds hard limit per hotel
- Extract via JSON-LD first (`script[type="application/ld+json"]`)
- Fallback to CSS selectors for: rating, review count, room types
- Null-safe: missing fields return `null`, never invented

### Phase 4 — AI Summary Generation
- `generateSummary.ts`: POST structured data to Claude API
- System prompt enforces: summarize only what was extracted, no invention
- Output: 2–3 sentence hotel description
- Model: `claude-sonnet-4-20250514`

### Phase 5 — Storage
- `saveResult.ts`: Upsert into Supabase `hotel_enrichments`
- Record includes: all extracted fields + `sources[]`, `extraction_confidence`, `updated_at`
- Confidence score derived from how many fields were successfully extracted

### Phase 6 — Chatbot Layer
- `query.ts`: Check Supabase for existing record
- If `updated_at` within 7 days → return cached
- If stale or missing → trigger `runPipeline.ts` → return result
- `chat.ts` API route: accepts `{ message: string }`, returns `{ reply: string }`

### Phase 7 — UI
- Single HTML page with light blue theme
- Textarea input + send button
- Conversation history rendered in chat bubbles
- Connects to `POST /api/chat`

---

## Supabase Schema

```sql
-- Existing source table
CREATE TABLE hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_name TEXT NOT NULL,
  location TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enriched output table
CREATE TABLE hotel_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_name TEXT NOT NULL,
  location TEXT NOT NULL,
  booking_url TEXT,
  rating NUMERIC(3,1),
  rating_count INTEGER,
  number_of_rooms INTEGER,
  family_rooms BOOLEAN,
  connected_rooms BOOLEAN,
  ai_summary TEXT,
  sources TEXT[],
  extraction_confidence NUMERIC(3,2),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hotel_name, location)
);

CREATE INDEX idx_enrichments_lookup ON hotel_enrichments(hotel_name, location);
CREATE INDEX idx_enrichments_updated ON hotel_enrichments(updated_at);
```

---

## Example API Route — POST /api/chat

**Request:**
```json
{ "message": "Tell me about Hotel Riviera in Lucerne" }
```

**Response (cached):**
```json
{
  "reply": "Hotel Riviera in Lucerne has a rating of 8.9 based on 1,342 reviews. It offers family rooms and is centrally located. [Cached result]",
  "source": "cache",
  "data": { ... }
}
```

**Response (pipeline triggered):**
```json
{
  "reply": "Hotel Riviera in Lucerne scores 8.9/10 with over 1,300 reviews...",
  "source": "pipeline",
  "data": { ... }
}
```

---

## Environment Variables

```env
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
ANTHROPIC_API_KEY=
SERP_API_KEY=           # or alternative Google search provider
PLAYWRIGHT_HEADLESS=true
```

---

## Vercel Configuration

```json
{
  "functions": {
    "src/api/chat.ts": {
      "maxDuration": 60
    }
  }
}
```

---

## Key Dependencies

| Package | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Claude API client |
| `@supabase/supabase-js` | Supabase client |
| `playwright` | Dynamic page scraping |
| `axios` | HTTP requests / Google search |
| `cheerio` | HTML parsing fallback |
| `typescript` | Type safety |
| `zod` | Runtime schema validation |

---

## Timeline Estimate

| Phase | Effort |
|---|---|
| Schema + Supabase setup | 0.5 day |
| Web discovery + scraper | 2 days |
| Data extraction + confidence scoring | 1 day |
| Claude integration + prompt tuning | 0.5 day |
| Chatbot API route + cache logic | 1 day |
| UI | 0.5 day |
| Testing + hardening | 1 day |
| **Total** | **~6.5 days** |
