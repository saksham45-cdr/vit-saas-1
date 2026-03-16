// In-memory rate limiter for Vercel serverless.
// Each serverless instance has its own store — for strict cross-instance
// enforcement at scale, replace the Map with Upstash Redis.
import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_REQUESTS = 100;
const WINDOW_MS = 15 * 60 * 1_000; // 15 minutes

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

export function rateLimit(req: VercelRequest, res: VercelResponse): boolean {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)
      ?.split(",")[0]
      ?.trim() ?? "unknown";

  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1_000);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return false;
  }

  entry.count++;
  return true;
}
