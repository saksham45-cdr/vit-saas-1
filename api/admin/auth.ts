/**
 * api/admin/auth.ts → POST /api/admin/auth  (login)
 *                   → DELETE /api/admin/auth (logout)
 * ─────────────────────────────────────────────────────────────────
 * POST: validates the submitted password against ADMIN_PASSWORD (server-
 *   side env var) and sets a signed HttpOnly session cookie on success.
 *   The password is never echoed back or logged.
 *
 * DELETE: clears the session cookie (logout).
 *
 * Security notes:
 *   • The actual ADMIN_PASSWORD never reaches the browser.
 *   • The session token is HMAC-signed; an attacker cannot forge it
 *     without knowing ADMIN_PASSWORD.
 *   • A wrong password returns a generic "Access denied." — no hint
 *     about whether ADMIN_PASSWORD is configured.
 *   • Response body never contains secrets.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import {
  buildContext,
  parseBody,
  sendError,
} from "../../src/middleware/http.js";
import {
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from "../../src/middleware/adminAuth.js";
import { getEnv } from "../../src/config/env.js";
import { AppError } from "../../src/utils/errors.js";

const LoginSchema = z.object({
  password: z.string().min(1),
});

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const ctx = buildContext(req, res, "/api/admin/auth");
  try {
    if (req.method === "DELETE") {
      clearSessionCookie(res);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: { code: "BAD_REQUEST", message: "Method not allowed" } });
      return;
    }

    const { password } = parseBody(req, LoginSchema);
    const env = getEnv();

    // Intentionally generic error — do not reveal whether ADMIN_PASSWORD is set.
    if (!env.ADMIN_PASSWORD) {
      throw new AppError("UNAUTHORIZED", "Access denied.", { httpStatus: 401, expose: true });
    }

    // Constant-time comparison via Node.js crypto (avoid timing attacks)
    const { timingSafeEqual } = await import("node:crypto");
    const a = Buffer.from(password);
    const b = Buffer.from(env.ADMIN_PASSWORD);
    const match =
      a.length === b.length &&
      timingSafeEqual(a, b);

    if (!match) {
      ctx.logger.warn("admin auth: wrong password attempt");
      throw new AppError("UNAUTHORIZED", "Access denied.", { httpStatus: 401, expose: true });
    }

    const token = createSessionToken(env.ADMIN_PASSWORD);
    setSessionCookie(res, token);
    ctx.logger.info("admin session created");
    res.status(200).json({ ok: true });
  } catch (err) {
    sendError(res, ctx, err);
  }
}
