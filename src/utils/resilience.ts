/**
 * utils/resilience.ts
 * ─────────────────────────────────────────────────────────────────
 * Retries (exponential backoff + jitter), timeouts, and a circuit
 * breaker shared by every outbound integration.
 *
 * Architectural note on the circuit breaker in a serverless world:
 * in-memory breaker state only protects within one warm instance.
 * That is still valuable (it stops a hot instance from hammering a
 * dead upstream), but HARD limits that must hold globally (e.g. the
 * $20 DataForSEO stop) are enforced in the database by the usage
 * monitor, not here. Breakers = latency protection; DB limits = money
 * protection.
 */
import { Errors } from "./errors.js";
import type { Logger } from "./logger.js";

export interface RetryOptions {
  attempts?: number; // total attempts including the first
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number; // per-attempt timeout
  retryOn?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  provider: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) throw Errors.upstreamTimeout(provider, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function retry<T>(
  provider: string,
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 250;
  const max = opts.maxDelayMs ?? 4_000;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retryOn = opts.retryOn ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await withTimeout(fn, timeoutMs, provider);
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !retryOn(err)) break;
      // Full jitter exponential backoff: rand(0, min(max, base * 2^n))
      const cap = Math.min(max, base * 2 ** (attempt - 1));
      const delay = Math.floor(Math.random() * cap);
      opts.onRetry?.(attempt, err);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/* ── Circuit breaker ─────────────────────────────────────────── */

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

export class CircuitBreaker {
  private state: BreakerState = { failures: 0, openedAt: null };

  constructor(
    private readonly provider: string,
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly logger?: Logger,
  ) {}

  private isOpen(): boolean {
    if (this.state.openedAt === null) return false;
    if (Date.now() - this.state.openedAt >= this.cooldownMs) {
      // half-open: allow one probe through
      this.state.openedAt = null;
      this.state.failures = this.failureThreshold - 1;
      return false;
    }
    return true;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) throw Errors.circuitOpen(this.provider);
    try {
      const result = await fn();
      this.state.failures = 0;
      return result;
    } catch (err) {
      this.state.failures += 1;
      if (this.state.failures >= this.failureThreshold) {
        this.state.openedAt = Date.now();
        this.logger?.warn("circuit breaker opened", {
          provider: this.provider,
          failures: this.state.failures,
          cooldownMs: this.cooldownMs,
        });
      }
      throw err;
    }
  }
}
