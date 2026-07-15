/**
 * utils/errors.ts
 * ─────────────────────────────────────────────────────────────────
 * Typed error hierarchy. Every error that can cross a module boundary
 * is an AppError with a machine-readable `code`, an HTTP status, and a
 * flag for whether the message is safe to show to end users.
 *
 * Handlers convert AppErrors into a stable JSON error envelope:
 *   { error: { code, message, requestId } }
 */

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_ERROR"
  | "CIRCUIT_OPEN"
  | "USAGE_LIMIT_REACHED"
  | "LLM_OUTPUT_INVALID"
  | "DB_ERROR"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly expose: boolean; // is `message` safe for end users?
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { httpStatus?: number; expose?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.httpStatus = opts.httpStatus ?? 500;
    this.expose = opts.expose ?? false;
    this.details = opts.details;
  }
}

export const Errors = {
  badRequest: (msg: string, details?: Record<string, unknown>) =>
    new AppError("BAD_REQUEST", msg, { httpStatus: 400, expose: true, details }),
  unauthorized: (msg = "Unauthorized") =>
    new AppError("UNAUTHORIZED", msg, { httpStatus: 401, expose: true }),
  rateLimited: (retryAfterSec: number) =>
    new AppError("RATE_LIMITED", "Too many requests — please slow down.", {
      httpStatus: 429,
      expose: true,
      details: { retryAfterSec },
    }),
  usageLimit: (provider: string, msg: string) =>
    new AppError("USAGE_LIMIT_REACHED", msg, {
      httpStatus: 503,
      expose: true,
      details: { provider },
    }),
  circuitOpen: (provider: string) =>
    new AppError("CIRCUIT_OPEN", `${provider} is temporarily unavailable — please retry shortly.`, {
      httpStatus: 503,
      expose: true,
      details: { provider },
    }),
  upstreamTimeout: (provider: string, cause?: unknown) =>
    new AppError("UPSTREAM_TIMEOUT", `${provider} timed out`, { httpStatus: 504, cause }),
  upstream: (provider: string, msg: string, cause?: unknown) =>
    new AppError("UPSTREAM_ERROR", `${provider}: ${msg}`, { httpStatus: 502, cause }),
  db: (msg: string, cause?: unknown) =>
    new AppError("DB_ERROR", msg, { httpStatus: 500, cause }),
  internal: (msg: string, cause?: unknown) =>
    new AppError("INTERNAL", msg, { httpStatus: 500, cause }),
};

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) return Errors.internal(err.message, err);
  return Errors.internal(String(err));
}
