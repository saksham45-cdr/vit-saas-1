# Hotel Enrichment Pipeline

A pipeline that automatically enriches hotel data with ratings, room details, facilities, transit info, and AI summaries — exposed via a natural-language chatbot API.

## What It Does

1. Fetches hotels from the VIT Travel API
2. Finds each hotel's Booking.com page via web search
3. Scrapes rating and review count using Playwright
4. Extracts room details (family rooms, connecting rooms, facilities, nearby transit)
5. Generates an AI summary using Groq (LLaMA)
6. Stores everything in Supabase
7. Answers natural-language queries like _"family hotels in Spain"_ via a chat API

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Deployment:** Vercel (serverless)
- **Database:** Supabase (Postgres)
- **Scraping:** Playwright
- **Search:** Serper.dev → SerpAPI (fallback)
- **AI:** Groq API (LLaMA)

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- API keys for [Groq](https://console.groq.com), [Serper](https://serper.dev), and [SerpAPI](https://serpapi.com)

### Setup

```bash
git clone https://github.com/saksham45-cdr/vit-saas-1.git
cd vit-saas-1
npm install
cp .env.example .env
```

Fill in `.env` with your API keys, then:

```bash
npm run build
npm start
```

### Database

Run `supabase/schema.sql` against your Supabase project to create all tables.

## API

### `POST /api/chat`

Public endpoint. No auth required.

**Request:**
```json
{ "message": "family hotels in Spain" }
```

**Response:**
```json
{
  "reply": "Found 3 hotels in Spain with family rooms.",
  "results": [ ...HotelEnrichment[] ]
}
```

## Project Structure

```
src/
  api/          — Vercel serverless handlers
  pipeline/     — Enrichment pipeline steps
  chatbot/      — Intent parsing + hotel search + response formatting
  lib/          — Supabase, Groq, quota tracking, cache, logging
  middleware/   — Rate limiting, auth
  services/     — Secure HTTP client with URL allowlist
  types/        — Shared TypeScript interfaces
supabase/
  schema.sql    — Database schema
```

## Environment Variables

See `.env.example` for all variables and descriptions.

Key ones:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key |
| `GROQ_API_KEY` | AI summary generation |
| `SERPER_API_KEY` | Primary search (2,500/month free) |
| `SERP_API_KEY` | Fallback search (250/month free) |

## Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes and test locally
4. Open a pull request — describe what you changed and why

### Good First Issues

- Add support for more filter types in the chatbot (star rating, price range)
- Improve scraping resilience when Booking.com changes its HTML structure
- Add more search sources beyond Booking.com
- Write tests for `parseIntent` and `extractData`

## License

MIT
