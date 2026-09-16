/**
 * Open-redirect guard for post-authentication destinations. Only same-site
 * relative paths are honored; anything else falls back to the dashboard.
 * Shared by the auth callback route and the login page.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://")) {
    return fallback;
  }
  return value;
}
