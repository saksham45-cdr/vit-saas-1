export interface AuditEntry {
  timestamp: string;
  endpoint: string;
  status: number;
  durationMs: number;
  userId: string;
}

// Log every outbound API call. NEVER include API keys in log output.
export function logAudit(entry: AuditEntry): void {
  console.log(JSON.stringify(entry));
}

export function logError(
  context: string,
  endpoint: string,
  status: number,
  error: unknown
): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      context,
      endpoint,
      status,
      message: error instanceof Error ? error.message : "Unknown error",
    })
  );
}
