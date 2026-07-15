/**
 * utils/logger.ts
 * ─────────────────────────────────────────────────────────────────
 * Structured JSON logging. Every log line is a single JSON object so
 * Vercel / Datadog / Logflare can index it. A child logger carries a
 * requestId (and any other bound context) through an entire request.
 *
 * No silent failures anywhere in the codebase: errors are logged with
 * full structured detail before being translated into API responses.
 */

type Level = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: string;
  [key: string]: unknown;
}

function emit(level: Level, message: string, context: LogContext = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...context,
  });
  // eslint-disable-next-line no-console
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  child(bound: LogContext): Logger;
}

export function createLogger(bound: LogContext = {}): Logger {
  return {
    debug: (m, c) => emit("debug", m, { ...bound, ...c }),
    info: (m, c) => emit("info", m, { ...bound, ...c }),
    warn: (m, c) => emit("warn", m, { ...bound, ...c }),
    error: (m, c) => emit("error", m, { ...bound, ...c }),
    child: (extra) => createLogger({ ...bound, ...extra }),
  };
}

export const rootLogger = createLogger({ service: "hoteliq-backend" });

/** Serialize an unknown thrown value into a loggable object. */
export function errToLog(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { errName: err.name, errMessage: err.message, errStack: err.stack };
  }
  return { errValue: String(err) };
}
