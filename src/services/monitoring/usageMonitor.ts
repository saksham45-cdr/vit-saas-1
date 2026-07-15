/**
 * services/monitoring/usageMonitor.ts
 * ─────────────────────────────────────────────────────────────────
 * Centralized API usage + cost accounting for:
 *   nvidia_key_1, nvidia_key_2, dataforseo
 *
 * Design decisions:
 *  • State lives in Postgres (api_usage_daily), NOT in process memory.
 *    Serverless instances come and go; the only place a global "$20
 *    hard stop" can actually hold is the database. A single atomic
 *    RPC (record_api_usage) increments counters, so concurrent
 *    lambdas cannot race past a limit by more than one in-flight call.
 *  • Gates run BEFORE each outbound request:
 *      - NVIDIA keys: request-count quota; blocked at 80% of the
 *        configured daily quota.
 *      - DataForSEO: accumulated estimated cost; warning logged from
 *        $16, hard stop at exactly $20 (also blocked at 80% of the
 *        hard stop per the global 80% rule — 80% of $20 = $16, which
 *        is why the warning and the soft gate coincide; the enforced
 *        block uses the stricter of the two).
 *  • A short in-memory cache (2s) of today's counters keeps the gate
 *    from adding a DB round-trip to every single request in a burst.
 */
import { getSupabase } from "../database/supabase.js";
import { getEnv } from "../../config/env.js";
import { Errors } from "../../utils/errors.js";
import { rootLogger, errToLog } from "../../utils/logger.js";

export type TrackedProvider = "nvidia_key_1" | "nvidia_key_2" | "dataforseo";

export interface UsageRecord {
  success: boolean;
  latencyMs: number;
  retries?: number;
  tokens?: number;
  costUsd?: number;
}

interface DailyCounters {
  requests: number;
  failures: number;
  retries: number;
  tokens: number;
  cost_usd: number;
}

interface CacheEntry {
  at: number;
  counters: DailyCounters;
}

const CACHE_TTL_MS = 2_000;

export class UsageMonitor {
  private cache = new Map<string, CacheEntry>();
  private readonly log = rootLogger.child({ module: "usageMonitor" });

  private todayKey(provider: TrackedProvider): string {
    return `${provider}:${new Date().toISOString().slice(0, 10)}`;
  }

  private async getToday(provider: TrackedProvider): Promise<DailyCounters> {
    const key = this.todayKey(provider);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.counters;

    const { data, error } = await getSupabase()
      .from("api_usage_daily")
      .select("requests, failures, retries, tokens, cost_usd")
      .eq("provider", provider)
      .eq("usage_date", new Date().toISOString().slice(0, 10))
      .maybeSingle();

    if (error) throw Errors.db(`usage read failed for ${provider}`, error);

    const counters: DailyCounters = data ?? {
      requests: 0,
      failures: 0,
      retries: 0,
      tokens: 0,
      cost_usd: 0,
    };
    this.cache.set(key, { at: Date.now(), counters });
    return counters;
  }

  /** Accumulated DataForSEO cost for the current calendar month. */
  private async getMonthlyCost(provider: TrackedProvider): Promise<number> {
    const monthStart = new Date().toISOString().slice(0, 8) + "01";
    const { data, error } = await getSupabase()
      .from("api_usage_daily")
      .select("cost_usd")
      .eq("provider", provider)
      .gte("usage_date", monthStart);
    if (error) throw Errors.db(`usage read failed for ${provider}`, error);
    return (data ?? []).reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
  }

  /**
   * Gate: throw USAGE_LIMIT_REACHED before a request is allowed to
   * spend money/quota. Called by every integration client.
   */
  async assertWithinLimits(provider: TrackedProvider): Promise<void> {
    const env = getEnv();

    if (provider === "dataforseo") {
      const monthlyCost = await this.getMonthlyCost(provider);
      const hardStop = env.DATAFORSEO_HARD_STOP_USD; // $20
      const warnAt = env.DATAFORSEO_WARN_USD; // $16
      const softGate = hardStop * 0.8; // 80% rule → $16
      const blockAt = Math.min(hardStop, Math.max(softGate, warnAt)); // never above hard stop

      if (monthlyCost >= warnAt) {
        this.log.warn("DataForSEO spend warning threshold crossed", {
          monthlyCostUsd: monthlyCost,
          warnAtUsd: warnAt,
          hardStopUsd: hardStop,
        });
      }
      if (monthlyCost >= blockAt) {
        throw Errors.usageLimit(
          "dataforseo",
          `DataForSEO disabled: estimated monthly spend $${monthlyCost.toFixed(2)} reached the ` +
            `protection threshold ($${blockAt.toFixed(2)}; hard stop $${hardStop.toFixed(2)}). ` +
            `Ingestion will resume next month or after the limit is raised.`,
        );
      }
      return;
    }

    // NVIDIA keys: daily request quota, blocked at 80%.
    const quota =
      provider === "nvidia_key_1"
        ? env.NVIDIA_KEY1_DAILY_REQUEST_QUOTA
        : env.NVIDIA_KEY2_DAILY_REQUEST_QUOTA;
    const today = await this.getToday(provider);
    const gate = Math.floor(quota * 0.8);
    if (today.requests >= gate) {
      throw Errors.usageLimit(
        provider,
        `${provider} disabled: ${today.requests} requests today reached 80% of the daily quota ` +
          `(${gate}/${quota}). Requests resume automatically tomorrow (UTC).`,
      );
    }
  }

  /**
   * Record one request atomically via the record_api_usage RPC
   * (INSERT ... ON CONFLICT DO UPDATE in a single statement).
   * Recording must never crash the caller's request path.
   */
  async record(provider: TrackedProvider, rec: UsageRecord): Promise<void> {
    try {
      const { error } = await getSupabase().rpc("record_api_usage", {
        p_provider: provider,
        p_success: rec.success,
        p_retries: rec.retries ?? 0,
        p_tokens: rec.tokens ?? 0,
        p_cost_usd: rec.costUsd ?? 0,
        p_latency_ms: rec.latencyMs,
      });
      if (error) throw error;
      this.cache.delete(this.todayKey(provider)); // force fresh read next gate
    } catch (err) {
      this.log.error("usage recording failed (request itself unaffected)", {
        provider,
        ...errToLog(err),
      });
    }
  }

  /** Snapshot for the internal monitoring endpoint. */
  async snapshot(): Promise<Record<string, unknown>> {
    const env = getEnv();
    const providers: TrackedProvider[] = ["nvidia_key_1", "nvidia_key_2", "dataforseo"];
    const monthStart = new Date().toISOString().slice(0, 8) + "01";

    const { data, error } = await getSupabase()
      .from("api_usage_daily")
      .select("*")
      .gte("usage_date", monthStart)
      .order("usage_date", { ascending: false });
    if (error) throw Errors.db("usage snapshot failed", error);

    const rows = data ?? [];
    const out: Record<string, unknown> = {};
    for (const p of providers) {
      const mine = rows.filter((r) => r.provider === p);
      const todayStr = new Date().toISOString().slice(0, 10);
      const today = mine.find((r) => r.usage_date === todayStr);
      const month = mine.reduce(
        (acc, r) => ({
          requests: acc.requests + Number(r.requests),
          failures: acc.failures + Number(r.failures),
          retries: acc.retries + Number(r.retries),
          tokens: acc.tokens + Number(r.tokens),
          costUsd: acc.costUsd + Number(r.cost_usd),
        }),
        { requests: 0, failures: 0, retries: 0, tokens: 0, costUsd: 0 },
      );
      out[p] = {
        today: today
          ? {
              requests: Number(today.requests),
              failures: Number(today.failures),
              retries: Number(today.retries),
              tokens: Number(today.tokens),
              costUsd: Number(today.cost_usd),
              avgLatencyMs:
                Number(today.requests) > 0
                  ? Math.round(Number(today.total_latency_ms) / Number(today.requests))
                  : 0,
              lastRequestAt: today.last_request_at,
            }
          : null,
        month,
        limits:
          p === "dataforseo"
            ? {
                hardStopUsd: env.DATAFORSEO_HARD_STOP_USD,
                warnAtUsd: env.DATAFORSEO_WARN_USD,
                blocked: month.costUsd >= env.DATAFORSEO_HARD_STOP_USD * 0.8,
              }
            : {
                dailyRequestQuota:
                  p === "nvidia_key_1"
                    ? env.NVIDIA_KEY1_DAILY_REQUEST_QUOTA
                    : env.NVIDIA_KEY2_DAILY_REQUEST_QUOTA,
                blockedAtPct: 80,
              },
      };
    }
    return out;
  }
}

let instance: UsageMonitor | null = null;
export function getUsageMonitor(): UsageMonitor {
  if (!instance) instance = new UsageMonitor();
  return instance;
}
