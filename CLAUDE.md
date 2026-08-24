# HotelIQ — VIT Travels SaaS Platform

## What this project is

Hotel intelligence SaaS for VIT Travels. A user types a hotel name + city, the backend enriches it with DataForSEO + NVIDIA LLM, stores results in Supabase, and returns a structured response with ratings, facilities, transit, and an AI summary.

## Architecture at a glance

```
Browser (Vanilla JS)
  └── POST /api/chat  (Vercel serverless, api/chat.ts)
        └── runSearch()  (src/services/search/searchService.ts)
              ├── Supabase DB cache check
              ├── DataForSEO organic search  →  scrape hotel data
              ├── NVIDIA LLM  →  extract structured fields
              ├── hotelRepository.upsertHotel()  →  Supabase
              └── generateHotelSummary()  →  AI text summary
```

## Frontend (public/)

Pure vanilla JS — no framework, no build step. Three files:

| File | Purpose |
|------|---------|
| `public/index.html` | HTML shell — sidebar, header, chat container, input |
| `public/chat.js` | All logic: state, search, rendering, carousel, modal |
| `public/style.css` | CSS design tokens (light/dark), components, animations |

### Key rendering functions in chat.js

| Function | What it does |
|----------|-------------|
| `renderHotelList(reply, results)` | Top-level results renderer; owns toolbar (view toggle, export) |
| `buildCarousel(results)` | Swipeable horizontal carousel — replaces old grid view |
| `buildCarouselCard(h)` | Single hotel card rendered inside carousel slide |
| `openHotelModal(h)` | Opens full-detail modal overlay for a hotel |
| `closeHotelModal()` | Closes modal, restores scroll |
| `buildTable(results)` | Table density view (unchanged) |
| `sendMessage()` | Sends query to `/api/chat`, handles all response paths |

### Hotel result data shape (from API response)

```typescript
{
  hotel_name: string
  city: string | null
  country: string | null
  location: string | null       // fallback: "city, country"
  rating: number | null         // 0–10
  rating_count: number | null
  number_of_rooms: number | null
  family_rooms: boolean | null
  connected_rooms: boolean | null
  facilities: string[]
  nearby_transit: string | null // comma-separated
  nearby_landmarks: string | null // comma-separated
  ai_summary: string | null
  hotel_url: string | null
  images: string[]
}
```

### localStorage keys (do not change shape)

| Key | Value |
|-----|-------|
| `hiq_chats` | `Chat[]` — full conversation history, sacred contract |
| `hiq_theme` | `"light"` \| `"dark"` |
| `hiq_sidebar_collapsed` | `"1"` \| `"0"` |
| `hiq_results_view` | `"cards"` \| `"table"` |

### CSS design tokens (`:root`)

Accent blue `#2554e8` · Emerald `#10b981` · Custom easing `--ease: cubic-bezier(0.16,1,0.3,1)` · Motion: `--t-fast: 150ms`, `--t-base: 200ms`, `--t-slow: 260ms` · Single breakpoint at `768px`.

## Backend services (src/services/)

| File | Purpose |
|------|---------|
| `search/searchService.ts` | Orchestrates cache → scrape → LLM → DB flow |
| `database/hotelRepository.ts` | Supabase upsert with 42P10 fallback (constraint may be missing) |
| `dataforseo/dataForSeoClient.ts` | DataForSEO organic search; requires `location_code: 2840` |
| `ingestion/ingestionService.ts` | Normalises raw scrape data, calls upsert |
| `ingestion/summaryGenerator.ts` | NVIDIA LLM summary; timeout 35 s (p99 latency) |
| `client_api/clientHotelApi.ts` | Fetches hotels from VIT client API, maps varied field names |

## Database (Supabase)

- Main table: `hotels` (23 columns, see `db/migrations/0001_init.sql`)
- Search: `search_hotels()` RPC function with FTS + trigram indexes (`0002_search.sql`)
- Pending: `db/migrations/0005_fix_unique_constraints.sql` — run this if upsert fallback path is firing

## Known issues / active context

- **Unique constraint migration**: `0005_fix_unique_constraints.sql` is pending. Until it runs, `hotelRepository` falls back to manual find-then-update. The fallback works but is slower.
- **NVIDIA LLM latency**: p99 exceeds 20 s; timeout bumped to 35 s. If summaries time out, check NVIDIA API status.
- **DataForSEO location_code**: `2840` (US) is hardcoded — required by the API even for global searches.

## Development notes

- No local build needed for frontend — edit `public/` files and reload.
- Backend runs as Vercel serverless; test locally with `vercel dev`.
- Env vars required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `NVIDIA_API_KEY`. See `.env` (not committed).
- Scripts: `scripts/ingest5.ts` for batch ingestion, `scripts/diag.ts` for diagnostics.

## Frontend rules (from code review)

- Text from API must always be set via `el.textContent`, never `innerHTML`.
- URLs from API must pass `safeUrl()` (validates `http:`/`https:` only) before being set on `<a href>`.
- Do not modify `hiq_chats` localStorage shape — backend-adjacent code depends on it.
- Keep carousel drag using Pointer Events API (not touch/mouse events separately).
