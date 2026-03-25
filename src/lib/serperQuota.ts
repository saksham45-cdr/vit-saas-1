import { getSupabaseClient } from "./supabase";
import { logError } from "./logger";

const MONTHLY_LIMIT = 2400; // hard stop — 100 buffer before 2,500 free cap
const WARN_AT = 2000;

export async function recordSerperCall(query: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase.from("serper_usage").insert({ query });
  } catch (err) {
    logError("serperQuota.record", "supabase:serper_usage", 0, err);
  }
}

export async function getSerperUsageThisMonth(): Promise<number> {
  const offset = parseInt(process.env.SERPER_USAGE_OFFSET ?? "0", 10);

  try {
    const supabase = getSupabaseClient();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count, error } = await supabase
      .from("serper_usage")
      .select("*", { count: "exact", head: true })
      .gte("called_at", startOfMonth.toISOString());

    if (error) throw error;
    return (count ?? 0) + offset;
  } catch (err) {
    logError("serperQuota.usage", "supabase:serper_usage", 0, err);
    return offset;
  }
}

// Returns false if hard stop reached (2,400). Logs warning at 2,000.
export async function checkAndRecordSerperCall(query: string): Promise<boolean> {
  const used = await getSerperUsageThisMonth();

  if (used >= MONTHLY_LIMIT) {
    logError(
      "serperQuota.exceeded",
      "google.serper.dev",
      429,
      new Error(`Serper monthly hard stop reached: ${used}/${MONTHLY_LIMIT} calls used`)
    );
    return false;
  }

  if (used >= WARN_AT) {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        warning: "Serper quota warning",
        used,
        limit: MONTHLY_LIMIT,
        remaining: MONTHLY_LIMIT - used,
        freeCap: 2500,
      })
    );
  }

  await recordSerperCall(query);
  return true;
}
