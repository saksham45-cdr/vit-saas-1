// One-shot script to strip patch markers from any ai_summary rows already in DB.
// Run once: npx ts-node src/pipeline/repairSummaries.ts
import "dotenv/config";
import { getSupabaseClient } from "../lib/supabase";

function sanitize(text: string): string {
  return text
    .split("\n")
    .filter(line => !/^\*{3}|^```|^\s*\}\s*\*{3}/.test(line.trim()))
    .join(" ")
    .replace(/\*{3}\s*(?:Start|End)\s*Patch[^*]*/gi, "")
    .replace(/\*{3,}/g, "")
    .replace(/```+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("hotel_enrichments")
    .select("hotel_name, location, ai_summary")
    .not("ai_summary", "is", null);

  if (error) throw error;

  const corrupted = (data ?? []).filter(row =>
    row.ai_summary && /\*{3}|```}|End Patch/i.test(row.ai_summary)
  );

  if (corrupted.length === 0) {
    console.log("No corrupted summaries found.");
    return;
  }

  console.log(`Found ${corrupted.length} corrupted summaries — repairing...`);

  for (const row of corrupted) {
    const cleaned = sanitize(row.ai_summary);
    const { error: updateErr } = await supabase
      .from("hotel_enrichments")
      .update({ ai_summary: cleaned })
      .eq("hotel_name", row.hotel_name)
      .eq("location", row.location);

    if (updateErr) {
      console.error(`  FAILED: ${row.hotel_name} — ${updateErr.message}`);
    } else {
      console.log(`  Fixed: ${row.hotel_name} (${row.location})`);
    }
  }

  console.log("Done.");
}

main().catch(err => { console.error(err); process.exit(1); });
