import { getSupabaseClient } from "./supabase";

const CHECKPOINT_ID = 1;
const RESET_AFTER_DAYS = 30;

export interface Checkpoint {
  last_page: number;
  last_offset: number; // index within the page (0 = start of page)
}

// Returns the saved checkpoint, or {page:1, offset:0} if none exists.
// Auto-resets if the checkpoint is older than 30 days.
export async function readCheckpoint(): Promise<Checkpoint> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("pipeline_checkpoint")
    .select("*")
    .eq("id", CHECKPOINT_ID)
    .maybeSingle();

  if (error || !data) return { last_page: 1, last_offset: 0 };

  const ageMs = Date.now() - new Date(data.created_at).getTime();
  const limitMs = RESET_AFTER_DAYS * 24 * 60 * 60 * 1000;

  if (ageMs > limitMs) {
    console.log(`[Checkpoint] Older than ${RESET_AFTER_DAYS} days — resetting to page 1.`);
    await resetCheckpoint();
    return { last_page: 1, last_offset: 0 };
  }

  console.log(`[Checkpoint] Resuming from page ${data.last_page}, offset ${data.last_offset}.`);
  return { last_page: data.last_page, last_offset: data.last_offset };
}

// Persists current position after each batch so runs can resume mid-page.
export async function saveCheckpoint(last_page: number, last_offset: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("pipeline_checkpoint")
    .upsert(
      { id: CHECKPOINT_ID, last_page, last_offset, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) console.error("[Checkpoint] Failed to save:", error.message);
}

// Full reset — called automatically on 30-day expiry, or manually if needed.
export async function resetCheckpoint(): Promise<void> {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  await supabase
    .from("pipeline_checkpoint")
    .upsert(
      { id: CHECKPOINT_ID, last_page: 1, last_offset: 0, created_at: now, updated_at: now },
      { onConflict: "id" }
    );
}
