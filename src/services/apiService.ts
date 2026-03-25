import axios, { AxiosError } from "axios";
import { logAudit, logError } from "../lib/logger";

// Strict whitelist of allowed external API endpoints.
// Never construct or accept URLs from user input — use only these constants.
export const ALLOWED_ENDPOINTS = {
  VIT_HOTELS: "https://api.vit.travel/hotels/index.php",
  SERP_API: "https://serpapi.com/search",
  SERPER_DEV: "https://google.serper.dev/search",
  VALUESERP: "https://api.valueserp.com/search",
} as const;

export type AllowedEndpoint = (typeof ALLOWED_ENDPOINTS)[keyof typeof ALLOWED_ENDPOINTS];

function assertHttps(url: string): void {
  if (!url.startsWith("https://")) {
    throw new Error(`SSRF guard: API URL must use https://. Got: ${url}`);
  }
}

function isWhitelisted(url: string): url is AllowedEndpoint {
  return (Object.values(ALLOWED_ENDPOINTS) as string[]).some((allowed) =>
    url.startsWith(allowed)
  );
}

// Central function for all outbound GET requests.
// Params are passed as query string — never embedded in the URL string directly.
// API keys passed via params are NOT logged (only the base endpoint is logged).
export async function secureGet<T>(
  endpoint: AllowedEndpoint,
  params: Record<string, string | number> = {},
  userId = "system"
): Promise<T> {
  assertHttps(endpoint);

  if (!isWhitelisted(endpoint)) {
    throw new Error(`Endpoint not in whitelist: ${endpoint}`);
  }

  const start = Date.now();
  let status = 0;

  try {
    const response = await axios.get<T>(endpoint, { params, timeout: 15_000 });
    status = response.status;

    // Log base endpoint only — params (which may contain API keys) are never logged
    logAudit({
      timestamp: new Date().toISOString(),
      endpoint,
      status,
      durationMs: Date.now() - start,
      userId,
    });

    return response.data;
  } catch (err) {
    const axiosErr = err as AxiosError;
    status = axiosErr.response?.status ?? 0;

    logError("apiService.secureGet", endpoint, status, err);

    if (status === 401) throw new Error("External API authentication failed");
    if (status === 429) throw new Error("External API rate limit exceeded — retry later");
    if (status >= 500) throw new Error("External API server error");

    throw new Error("External API call failed");
  }
}

// Central function for all outbound POST requests (e.g. Serper.dev).
// Body is passed as JSON — never embedded in the URL.
// The apiKey is passed via header and is NOT logged.
export async function securePost<T>(
  endpoint: AllowedEndpoint,
  body: Record<string, string | number>,
  apiKey: string,
  userId = "system"
): Promise<T> {
  assertHttps(endpoint);

  if (!isWhitelisted(endpoint)) {
    throw new Error(`Endpoint not in whitelist: ${endpoint}`);
  }

  const start = Date.now();
  let status = 0;

  try {
    const response = await axios.post<T>(endpoint, body, {
      timeout: 15_000,
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
    });
    status = response.status;

    // Log base endpoint only — headers (which contain the API key) are never logged
    logAudit({
      timestamp: new Date().toISOString(),
      endpoint,
      status,
      durationMs: Date.now() - start,
      userId,
    });

    return response.data;
  } catch (err) {
    const axiosErr = err as AxiosError;
    status = axiosErr.response?.status ?? 0;

    logError("apiService.securePost", endpoint, status, err);

    if (status === 401) throw new Error("External API authentication failed");
    if (status === 429) throw new Error("External API rate limit exceeded — retry later");
    if (status >= 500) throw new Error("External API server error");

    throw new Error("External API call failed");
  }
}
