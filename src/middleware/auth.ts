// Auth guard for internal/pipeline API routes.
// Set INTERNAL_API_KEY in .env to enable; leave unset to allow all (dev mode).
// The public /api/chat route uses rate limiting only (no login required — by design).
import type { VercelRequest, VercelResponse } from "@vercel/node";

export function requireAuth(req: VercelRequest, res: VercelResponse): boolean {
  const requiredKey = process.env.INTERNAL_API_KEY;

  // Auth is disabled when the key is not configured (dev / local mode)
  if (!requiredKey) return true;

  const provided = req.headers["x-api-key"];
  if (!provided || provided !== requiredKey) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}
