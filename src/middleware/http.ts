/**
 * middleware/http.ts
 * ─────────────────────────────────────────────────────────────────
 * Shared HTTP plumbing for every Vercel function:
 *   • request IDs bound into a per-request logger,
 *   • one JSON error envelope for every failure path,
 *   • method guard, body validation helper,
 *   • lightweight per-IP rate limiting (in-memory token window per
 *     warm instance — basic abuse protection; see README for the
 *     Redis-backed upgrade path),
 *   • bearer auth for internal endpoints.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { AppError, Errors, toAppError } from "../utils/errors.js";
import { createLogger, errToLog, type Logger } from "../utils/logger.js";

export interface RequestContext {
  requestId: string;
  logger: Logger;
}

export function buildContext(req: VercelRequest, res: VercelResponse, route: string): RequestContext {
  const incoming = req.headers["x-request-id"];
  const requestId =
    (typeof incoming === "string" && incoming.slice(0, 64)) || randomUUID();
  res.setHeader("x-request-id", requestId);
  return {
    requestId,
    logger: createLogger({ service: "hoteliq-backend", route, requestId }),
  };
}

export function sendError(res: VercelResponse, ctx: RequestContext, err: unknown): void {
  const appErr = toAppError(err);
  ctx.logger.error("request failed", {
    code: appErr.code,
    httpStatus: appErr.httpStatus,
    ...errToLog(appErr),
  });
  if (appErr.code === "RATE_LIMITED" && appErr.details?.retryAfterSec) {
    res.setHeader("Retry-After", String(appErr.details.retryAfterSec));
  }
  res.status(appErr.httpStatus).json({
    error: {
      code: appErr.code,
      message: appErr.expose ? appErr.message : "Internal server error",
      requestId: ctx.requestId,
    },
  });
}

export function requireMethod(req: VercelRequest, method: string): void {
  if (req.method !== method) {
    throw new AppError("BAD_REQUEST", `Method ${req.method} not allowed`, {
      httpStatus: 405,
      expose: true,
    });
  }
}

export function parseBody<T>(req: VercelRequest, schema: z.ZodType<T>): T {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw new AppError(
      "VALIDATION_FAILED",
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      { httpStatus: 400, expose: true },
    );
  }
  return result.data;
}

/* ── Rate limiting (sliding window, per warm instance) ───────── */

const hits = new Map<string, number[]>();

export function rateLimit(req: VercelRequest): void {
  const env = getEnv();
  const ip =
    (typeof req.headers["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"].split(",")[0].trim()
      : null) ??
    req.socket?.remoteAddress ??
    "unknown";

  const now = Date.now();
  const windowStart = now - env.RATE_LIMIT_WINDOW_MS;
  const timestamps = (hits.get(ip) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= env.RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSec = Math.ceil((timestamps[0] + env.RATE_LIMIT_WINDOW_MS - now) / 1000);
    throw Errors.rateLimited(Math.max(1, retryAfterSec));
  }
  timestamps.push(now);
  hits.set(ip, timestamps);

  // Opportunistic cleanup so the map can't grow unbounded.
  if (hits.size > 5_000) {
    for (const [key, arr] of hits) {
      if (arr.every((t) => t <= windowStart)) hits.delete(key);
    }
  }
}

/* ── Internal endpoint auth ──────────────────────────────────── */

export function requireInternalAuth(req: VercelRequest): void {
  const secret = getEnv().INTERNAL_API_SECRET;
  if (!secret) {
    throw new AppError("UNAUTHORIZED", "Internal endpoints disabled: INTERNAL_API_SECRET not set", {
      httpStatus: 503,
      expose: true,
    });
  }
  const header = req.headers.authorization;
  if (header !== `Bearer ${secret}`) throw Errors.unauthorized();
}
