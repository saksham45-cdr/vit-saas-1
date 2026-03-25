import { getSupabaseClient } from "./supabase";
import { logError } from "./logger";

const MONTHLY_LIMIT = 250;
const WARN_AT = 200; // warn when this many calls used

export async function recordSerpCall(query: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from("serp_usage").insert({ query });
  } catch (err) {
    // Non-fatal — log and continue, never block a pipeline run over tracking
    logError("serpQuota.record", "supabase:serp_usage", 0, err);
  }
}

export async function getSerpUsageThisMonth(): Promise<number> {
  // Offset accounts for calls made before serp_usage tracking was active.
  // Set SERP_USAGE_OFFSET=N in .env to seed the baseline.
  const offset = parseInt(process.env.SERP_USAGE_OFFSET ?? "0", 10);

  try {
    const supabase = getSupabaseClient();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count, error } = await supabase
      .from("serp_usage")
      .select("*", { count: "exact", head: true })
      .gte("called_at", startOfMonth.toISOString());

    if (error) throw error;
    return (count ?? 0) + offset;
  } catch (err) {
    logError("serpQuota.usage", "supabase:serp_usage", 0, err);
    return offset;
  }
}

// Call before making a SerpAPI request.
// Returns false and logs a warning if quota is exceeded.
export async function checkAndRecordSerpCall(query: string): Promise<boolean> {
  const used = await getSerpUsageThisMonth();

  if (used >= MONTHLY_LIMIT) {
    logError(
      "serpQuota.exceeded",
      "serpapi.com",
      429,
      new Error(`SerpAPI monthly quota exhausted: ${used}/${MONTHLY_LIMIT} calls used`)
    );
    return false;
  }

  if (used >= WARN_AT) {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        warning: "SerpAPI quota warning",
        used,
        limit: MONTHLY_LIMIT,
        remaining: MONTHLY_LIMIT - used,
      })
    );
  }

  await recordSerpCall(query);
  return true;
}
