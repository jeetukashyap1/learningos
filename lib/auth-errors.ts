/**
 * Maps Supabase auth errors (and infrastructure errors) to short, honest
 * sentences for the auth forms. Shared by every auth page so messaging stays
 * consistent; raw service messages never reach the UI.
 */
export function describeAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const lower = message.toLowerCase();

  if (message.includes("LearningOS is missing required Supabase")) {
    return "Authentication is not configured yet. Add your Supabase credentials to .env.local and restart the dev server.";
  }
  if (lower.includes("invalid login credentials")) {
    return "We could not sign you in with those details. Double-check your email and password.";
  }
  if (lower.includes("email not confirmed")) {
    return "Your email address is not verified yet. Open the confirmation link we sent you, then sign in.";
  }
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "An account already exists for this email. Try signing in instead.";
  }
  if (lower.includes("rate limit") || lower.includes("once every")) {
    return "Too many attempts. Please wait a moment before trying again.";
  }
  if (lower.includes("not authenticated") || lower.includes("session missing")) {
    return "Your reset link has expired or was already used. Request a new one from the password reset page.";
  }
  if (lower.includes("fetch failed") || lower.includes("network")) {
    return "We could not reach the authentication service. Check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
}
