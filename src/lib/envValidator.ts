// Validates all required environment variables at startup.
// Call validateEnv() once at the entry point of every API route.

const REQUIRED_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "GROQ_API_KEY",
] as const;

// All of these must start with https://
const HTTPS_VARS = ["SUPABASE_URL"] as const;

export function validateEnv(): void {
  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }

  for (const key of HTTPS_VARS) {
    if (!process.env[key]!.startsWith("https://")) {
      throw new Error(`Env var ${key} must use https://`);
    }
  }

  // Enforce https on VIT API URL if overridden
  const vitUrl =
    process.env.VIT_HOTELS_API_URL ?? "https://api.vit.travel/hotels/index.php";
  if (!vitUrl.startsWith("https://")) {
    throw new Error("Env var VIT_HOTELS_API_URL must use https://");
  }
}
