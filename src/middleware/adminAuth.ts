/**
 * middleware/adminAuth.ts
 * ─────────────────────────────────────────────────────────────────
 * Stateless HMAC-SHA256 session tokens for the admin operations panel.
 *
 * Token format (base64url-encoded): "<timestamp_ms>.<hex_hmac>"
 * The HMAC is keyed on ADMIN_PASSWORD, so an invalid/rotated password
 * immediately invalidates all existing tokens without any DB lookup.
 *
 * Security properties:
 *   • Password never leaves the server — the browser only receives a
 *     signed token in an HttpOnly cookie.
 *   • timingSafeEqual prevents timing attacks on signature comparison.
 *   • 4-hour expiry is embedded in the token itself.
 *   • SameSite=Strict blocks CSRF. Secure flag added in production.
 *   • Cookie is HttpOnly — inaccessible to browser JavaScript.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getEnv } from "../config/env.js";
import { AppError } from "../utils/errors.js";

export const SESSION_COOKIE = "hiq_ops_session";
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function createSessionToken(secret: string): string {
  const ts = Date.now().toString();
  const sig = hmac(ts, secret);
  return Buffer.from(`${ts}.${sig}`).toString("base64url");
}

export function verifySessionToken(token: string, secret: string): boolean {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const dot = decoded.lastIndexOf(".");
    if (dot === -1) return false;

    const ts = decoded.slice(0, dot);
    const sig = decoded.slice(dot + 1);

    // Reject expired tokens
    const age = Date.now() - parseInt(ts, 10);
    if (Number.isNaN(age) || age < 0 || age > SESSION_TTL_MS) return false;

    // Timing-safe comparison against the expected HMAC
    const expected = hmac(ts, secret);
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function setSessionCookie(res: VercelResponse, token: string): void {
  const isProd = getEnv().NODE_ENV === "production";
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: VercelResponse): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
  );
}

/**
 * Guard for admin-only endpoints.
 * Throws UNAUTHORIZED (401) if the session cookie is absent, expired,
 * or its HMAC doesn't match the current ADMIN_PASSWORD.
 * Throws UNAUTHORIZED (503) if ADMIN_PASSWORD is not configured.
 */
export function requireAdminSession(req: VercelRequest): void {
  const env = getEnv();
  if (!env.ADMIN_PASSWORD) {
    throw new AppError(
      "UNAUTHORIZED",
      "Admin access is not configured on this server. Set ADMIN_PASSWORD.",
      { httpStatus: 503, expose: true },
    );
  }
  const cookies = parseCookies(req.headers.cookie ?? "");
  const token = cookies[SESSION_COOKIE];
  if (!token || !verifySessionToken(token, env.ADMIN_PASSWORD)) {
    throw new AppError("UNAUTHORIZED", "Access denied.", { httpStatus: 401, expose: true });
  }
}
