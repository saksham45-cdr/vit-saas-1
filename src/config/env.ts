/**
 * config/env.ts
 * ─────────────────────────────────────────────────────────────────
 * Single, validated source of truth for every environment variable.
 *
 * Architectural decision: env access is centralized so that a missing
 * or malformed secret fails LOUDLY at cold start (for required vars)
 * instead of surfacing as a confusing runtime error deep inside a
 * service. Nothing else in the codebase reads process.env directly.
 */
import { z } from "zod";

const EnvSchema = z.object({
  // NVIDIA LLM keys — two distinct keys, two distinct responsibilities.
  NVIDIA_API_KEY_1: z.string().min(1, "NVIDIA_API_KEY_1 (query intelligence) is required"),
  NVIDIA_API_KEY_2: z.string().min(1, "NVIDIA_API_KEY_2 (summary generation) is required"),

  // DataForSEO (ingestion-time only)
  DATAFORSEO_USERNAME: z.string().min(1),
  DATAFORSEO_PASSWORD: z.string().min(1),

  // Supabase — service role key is server-side ONLY, never shipped to a client.
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Client hotel database API
  CLIENT_HOTEL_DATABASE_KEY: z.string().min(1),
  CLIENT_HOTEL_DATABASE_URL: z.string().url().default("https://client-hotels.example.com/api/hotels"),

  // Internal endpoint protection (monitoring / ingestion triggers)
  INTERNAL_API_SECRET: z.string().min(16).optional(),

  // Vercel
  VERCEL_OIDC_TOKEN: z.string().optional(),

  // Tunables (all optional, sane defaults)
  NVIDIA_MODEL_QUERY: z.string().default("meta/llama-3.1-70b-instruct"),
  NVIDIA_MODEL_SUMMARY: z.string().default("meta/llama-3.1-70b-instruct"),
  NVIDIA_BASE_URL: z.string().url().default("https://integrate.api.nvidia.com/v1"),

  NVIDIA_KEY1_DAILY_REQUEST_QUOTA: z.coerce.number().int().positive().default(5000),
  NVIDIA_KEY2_DAILY_REQUEST_QUOTA: z.coerce.number().int().positive().default(2000),

  DATAFORSEO_HARD_STOP_USD: z.coerce.number().positive().default(20),
  DATAFORSEO_WARN_USD: z.coerce.number().positive().default(16),
  DATAFORSEO_COST_PER_TASK_USD: z.coerce.number().positive().default(0.002),

  SEARCH_CACHE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  SEARCH_RESULT_LIMIT: z.coerce.number().int().positive().max(50).default(12),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(30),

  INGEST_BATCH_SIZE: z.coerce.number().int().positive().max(50).default(10),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/** Lazily parse env so unit tests can stub process.env before first access. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper */
export function resetEnvCache(): void {
  cached = null;
}
