# HotelIQ Backend

Production backend for the HotelIQ hotel research assistant. Two fully independent pipelines: a slow, accuracy-first **enrichment pipeline** that builds the hotel database, and a fast, internet-free **search pipeline** that serves the existing frontend without any frontend changes.

## Architecture

```
PIPELINE 1 — Hotel Enrichment (async, accuracy > speed)
  Client Hotel DB ──▶ ingestion queue (Postgres, SKIP LOCKED)
        worker (Vercel cron, every 5 min):
        DataForSEO Google Organic ──▶ deterministic normalizer
        ──▶ NVIDIA LLM #2 (summary, once, stored forever)
        ──▶ Supabase upsert

PIPELINE 2 — User Search (sync, < ~500 ms)
  POST /api/chat { message }
        ──▶ response cache (hit ⇒ no LLM, no DB)
        ──▶ NVIDIA LLM #1 (query → validated JSON filters;
             1 retry on invalid JSON, then keyword fallback)
        ──▶ search_hotels() Postgres function
             (FTS + trigram + structured filters, indexed, ranked)
        ──▶ { reply, results }   ← exact shape chat.js renders
```

The two pipelines share only the database and the usage monitor. The search pipeline has **no imports** from DataForSEO, the client API, or LLM #2 — internet access during search is structurally impossible, not just discouraged.

### Frontend contract (preserved)

`POST /api/chat` with `{ "message": string }` returns:

```json
{
  "reply": "Found 3 family-friendly hotels in Barcelona, ranked by best match.",
  "results": [
    {
      "hotel_name": "...", "city": "...", "country": "...", "location": "...",
      "rating": 4.6, "rating_count": 2412, "number_of_rooms": 75,
      "family_rooms": true, "connected_rooms": true,
      "facilities": ["Free WiFi", "Pool"],
      "nearby_transit": "Paral·lel metro station, Funicular de Montjuïc",
      "nearby_landmarks": "Montjuïc, Gothic Quarter",
      "ai_summary": "...", "hotel_url": "...", "images": []
    }
  ]
}
```

Field names, `nearby_transit` as a comma-separated string, tri-state booleans (`true`/`false`/`null` → Yes/No/Unknown), and the `location` alias for `fmtCity()` all match `chat.js` exactly. Errors return non-2xx with `{ error: { code, message, requestId } }` — the frontend already handles any non-OK status generically.

## Repository layout

```
api/                        Vercel serverless routes
  chat.ts                   POST /api/chat            (public, rate-limited)
  health.ts                 GET  /api/health          (public)
  internal/
    monitoring.ts           GET  usage + cost + queue (Bearer INTERNAL_API_SECRET)
    ingest.ts               POST enqueue a client-DB page (Bearer secret)
    ingest-worker.ts        cron-driven batch worker  (Bearer CRON_SECRET)
src/
  config/env.ts             validated env (fails loudly on misconfig)
  middleware/http.ts        request IDs, error envelope, rate limit, internal auth
  services/
    search/                 queryParser (LLM #1), filterSchema, searchService, cache
    ingestion/              queue, normalizer, summaryGenerator (LLM #2), orchestrator
    llm/nvidiaClient.ts     shared NVIDIA client — two isolated keys
    dataforseo/             Google Organic client (cost-gated)
    client_api/             client hotel database adapter
    database/               Supabase singleton + hotel repository
    monitoring/             usage monitor (quotas, cost, 80% gates)
  utils/                    logger, errors, resilience (retry/breaker), sanitize
db/
  migrations/0001–0004      schema, FTS + indexes, usage accounting, job queue
  seed.sql                  dev-only demo data
```

## Setup

1. **Database** — run migrations in order against your Supabase project:

   ```bash
   psql "$SUPABASE_DB_URL" -f db/migrations/0001_init.sql
   psql "$SUPABASE_DB_URL" -f db/migrations/0002_search.sql
   psql "$SUPABASE_DB_URL" -f db/migrations/0003_usage.sql
   psql "$SUPABASE_DB_URL" -f db/migrations/0004_queue.sql
   # optional, local dev only:
   psql "$SUPABASE_DB_URL" -f db/seed.sql
   ```

   (Or copy each file into the Supabase SQL editor.) All tables have RLS enabled with no public policies — only the backend's service-role key can read or write them.

2. **Environment** — `cp .env.example .env` and fill in real values. `INTERNAL_API_SECRET` and `CRON_SECRET` should each be a long random string (`openssl rand -hex 32`).

3. **Install & verify**

   ```bash
   npm install
   npm run typecheck
   ```

4. **Local dev** — `npx vercel dev`, then serve the frontend files from the same origin (drop `index.html`, `style.css`, `chat.js` into `public/`) so `/api/chat` resolves.

## Deployment (Vercel)

1. `vercel link`, then add every variable from `.env.example` in Project → Settings → Environment Variables (including `CRON_SECRET`, which Vercel automatically attaches to cron invocations).
2. `vercel deploy --prod`. `vercel.json` configures:
   - per-function `maxDuration` (search: 10 s; worker: 300 s),
   - a cron hitting `/api/internal/ingest-worker` every 5 minutes.

## Operating the ingestion pipeline

Import (or refresh) the catalog by paging through the client database:

```bash
curl -X POST https://your-app.vercel.app/api/internal/ingest \
  -H "Authorization: Bearer $INTERNAL_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"cursor": null}'
# → { "fetched": 50, "enqueued": 50, "nextCursor": "..." }  — repeat with nextCursor
```

The cron worker then drains the queue in batches of `INGEST_BATCH_SIZE`, sequentially per batch (deliberate: keeps DataForSEO spend strictly monotonic against the budget gate). Failed jobs retry up to 3 times with exponential backoff; jobs stuck `processing` for 15+ minutes (crashed invocation) are reclaimed automatically.

## Cost & quota protection

All accounting lives in Postgres (`api_usage_daily`) via one atomic upsert RPC, so limits hold globally across serverless instances:

| Provider | Tracked | Gate |
|---|---|---|
| NVIDIA key 1 | requests + tokens, daily | blocked at **80%** of `NVIDIA_KEY1_DAILY_REQUEST_QUOTA` |
| NVIDIA key 2 | requests + tokens, daily | blocked at **80%** of `NVIDIA_KEY2_DAILY_REQUEST_QUOTA` |
| DataForSEO | estimated monthly USD | warnings from **$16**, hard stop at **$20** |

When a gate trips, the client throws `USAGE_LIMIT_REACHED` (HTTP 503 with a descriptive message) *before* any money is spent; the ingestion worker halts its batch immediately. Search degrades gracefully — if LLM #1 is over quota, the keyword-extraction fallback keeps search working with zero LLM calls.

Inspect everything live:

```bash
curl https://your-app.vercel.app/api/internal/monitoring \
  -H "Authorization: Bearer $INTERNAL_API_SECRET"
```

Returns per-provider daily/monthly requests, failures, retries, tokens, estimated cost, average latency, last request time, limit state, and ingestion queue depth.

## Search performance

- **No LLM after retrieval** — the reply string is composed deterministically.
- One DB round-trip: `search_hotels()` filters and ranks entirely in SQL.
- GIN index on a generated weighted `tsvector` (name A, city/keywords B, landmarks/transit C, summary D) — no full table scans.
- `pg_trgm` GIN indexes give typo tolerance ("Barclona" → Barcelona) and partial matches.
- Ranking = FTS relevance + trigram similarity + a **precomputed** quality score (rating, review volume, data completeness) stored at ingestion so query-time math stays cheap.
- Hot queries are served from an in-instance TTL/LRU cache (~ms, zero external calls).

Typical warm-path latency: cache hit < 10 ms; cache miss ≈ one LLM #1 call (~300–600 ms depending on model) + a single-digit-ms indexed query. If the 500 ms budget must hold on cache misses too, point `NVIDIA_MODEL_QUERY` at a smaller/faster model — the parsing task is easy.

## Security

- Service-role key server-side only; RLS enabled on every table; all SQL parameterized (Supabase RPC/query builder — no string SQL anywhere).
- Every request body zod-validated; every LLM output zod-validated with retry + fallback.
- Prompt-injection defense at both LLM boundaries: user queries and scraped web text are delimiter-wrapped, declared as data, and scraped text passes an injection-pattern scrubber before reaching LLM #2.
- Internal endpoints require a bearer secret; the public endpoint is rate-limited per IP.
- Rate limiting and the response cache are per warm instance (a deliberate serverless trade-off — they are optimizations/abuse-dampening, not correctness mechanisms; money-critical limits are DB-backed). For hard cross-instance rate limits, swap in Upstash Redis behind `middleware/http.ts`.

## Testing

The architecture is unit-test-ready: services take a `Logger`, external clients are isolated modules, pure logic (normalizer, filter schema, fallback parser, ranking) has no I/O. `scripts/smoke.ts` demonstrates the pure-function seams:

```bash
npx tsx scripts/smoke.ts
```
