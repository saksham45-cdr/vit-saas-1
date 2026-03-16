# Security Guide

## Required Environment Variables

| Variable | Purpose | Where to get it |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | Supabase dashboard → Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Supabase dashboard → Settings → API |
| `GROQ_API_KEY` | Groq AI API key | console.groq.com → API Keys |
| `SERP_API_KEY` | Google search API (SerpAPI) | serpapi.com → Dashboard |

## Optional Variables

| Variable | Purpose | Default |
|---|---|---|
| `VIT_HOTELS_API_URL` | Override VIT hotels API URL | `https://api.vit.travel/hotels/index.php` |
| `INTERNAL_API_KEY` | Protects pipeline routes via `x-api-key` header | unset (auth disabled) |
| `PLAYWRIGHT_HEADLESS` | Headless browser mode for scraping | `true` |

## Key Rotation

1. **Supabase**: Settings → API → Regenerate service key. Update `SUPABASE_SERVICE_KEY`, redeploy.
2. **Groq**: console.groq.com → API Keys → Delete old, create new. Update `GROQ_API_KEY`, redeploy.
3. **SerpAPI**: serpapi.com → Account → Regenerate API key. Update `SERP_API_KEY`, redeploy.
4. **Internal API Key**: Generate a new random string, update `INTERNAL_API_KEY`, redeploy. Update any callers.

## Security Architecture

- All third-party API calls go through `src/services/apiService.ts` with a strict URL whitelist
- No API keys or secrets are ever passed to the frontend or logged
- The frontend calls only `/api/chat` (our own backend) — never third-party APIs directly
- All outbound API calls are audit-logged (endpoint, status, duration — never the key itself)
- Rate limiting: 100 requests per 15 minutes per IP on `/api/chat`
- Error messages are sanitized before reaching the client (no raw API error bodies)
- All API base URLs are validated to use `https://` at startup
- SSRF protection: all URLs are checked against a strict whitelist before any request is made

## Reporting Security Issues

Open a private issue in the repository or contact the project owner directly.
