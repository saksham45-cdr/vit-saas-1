/**
 * services/llm/nvidiaClient.ts
 * ─────────────────────────────────────────────────────────────────
 * Thin, shared client for the NVIDIA (OpenAI-compatible) chat API.
 *
 * TWO keys, TWO responsibilities, strictly isolated:
 *   key1 → Query Intelligence Engine  (search-time, JSON only)
 *   key2 → Hotel Summary Generator    (ingestion-time only)
 *
 * Every call:
 *   1. asks the usage monitor for permission (80% quota gate),
 *   2. runs through a per-key circuit breaker,
 *   3. retries with exponential backoff on transient failures,
 *   4. reports usage (tokens, latency, success/failure) back to
 *      the monitor for cost/limit accounting.
 */
import { getEnv } from "../../config/env.js";
import { Errors, AppError } from "../../utils/errors.js";
import { CircuitBreaker, retry } from "../../utils/resilience.js";
import { rootLogger, errToLog, type Logger } from "../../utils/logger.js";
import { getUsageMonitor, type TrackedProvider } from "../monitoring/usageMonitor.js";

export type NvidiaKeyId = "nvidia_key_1" | "nvidia_key_2";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  attempts?: number;
  logger?: Logger;
}

interface ChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

const breakers: Record<NvidiaKeyId, CircuitBreaker> = {
  nvidia_key_1: new CircuitBreaker("nvidia_key_1", 5, 20_000, rootLogger),
  nvidia_key_2: new CircuitBreaker("nvidia_key_2", 5, 30_000, rootLogger),
};

function apiKeyFor(keyId: NvidiaKeyId): string {
  const env = getEnv();
  return keyId === "nvidia_key_1" ? env.NVIDIA_API_KEY_1 : env.NVIDIA_API_KEY_2;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof AppError) {
    // Timeouts and 5xx-style upstream errors are retryable; auth/limits are not.
    return err.code === "UPSTREAM_TIMEOUT" || err.code === "UPSTREAM_ERROR";
  }
  return true; // network-level errors
}

export async function nvidiaChat(keyId: NvidiaKeyId, opts: ChatOptions): Promise<ChatResult> {
  const env = getEnv();
  const log = (opts.logger ?? rootLogger).child({ provider: keyId, model: opts.model });
  const monitor = getUsageMonitor();
  const provider: TrackedProvider = keyId;

  // 1. Global (DB-backed) quota gate — throws USAGE_LIMIT_REACHED at 80%.
  await monitor.assertWithinLimits(provider);

  const started = Date.now();
  let retries = 0;

  try {
    const result = await breakers[keyId].exec(() =>
      retry(
        keyId,
        async (signal) => {
          const res = await fetch(`${env.NVIDIA_BASE_URL}/chat/completions`, {
            method: "POST",
            signal,
            headers: {
              Authorization: `Bearer ${apiKeyFor(keyId)}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: opts.model,
              messages: opts.messages,
              temperature: opts.temperature ?? 0,
              max_tokens: opts.maxTokens ?? 512,
              ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
            }),
          });

          if (!res.ok) {
            const body = await res.text().catch(() => "");
            const status = res.status;
            if (status === 401 || status === 403) {
              throw new AppError("UPSTREAM_ERROR", `${keyId} auth failed (${status})`, {
                httpStatus: 502,
              });
            }
            throw Errors.upstream(keyId, `HTTP ${status} ${body.slice(0, 300)}`);
          }

          const json = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const text = json.choices?.[0]?.message?.content;
          if (typeof text !== "string" || text.length === 0) {
            throw Errors.upstream(keyId, "empty completion");
          }
          return {
            text,
            promptTokens: json.usage?.prompt_tokens ?? 0,
            completionTokens: json.usage?.completion_tokens ?? 0,
          };
        },
        {
          attempts: opts.attempts ?? 3,
          timeoutMs: opts.timeoutMs ?? 8_000,
          retryOn: isRetryable,
          onRetry: (attempt, err) => {
            retries += 1;
            log.warn("nvidia call retrying", { attempt, ...errToLog(err) });
          },
        },
      ),
    );

    const latencyMs = Date.now() - started;
    await monitor.record(provider, {
      success: true,
      latencyMs,
      retries,
      tokens: result.promptTokens + result.completionTokens,
    });
    log.info("nvidia call ok", {
      latencyMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });
    return { ...result, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    await monitor.record(provider, { success: false, latencyMs, retries, tokens: 0 });
    log.error("nvidia call failed", { latencyMs, ...errToLog(err) });
    throw err;
  }
}
