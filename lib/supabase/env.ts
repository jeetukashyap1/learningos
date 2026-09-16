export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

/**
 * Reads and validates the public Supabase environment variables.
 * Fails fast with a clear, actionable message instead of silently misbehaving.
 */
export function getSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    const missing: string[] = [];
    if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    throw new Error(
      `LearningOS is missing required Supabase environment variable(s): ${missing.join(", ")}. ` +
        "Copy .env.example to .env.local and fill in your project credentials from the Supabase dashboard (Project Settings -> API)."
    );
  }

  return { url, anonKey };
}
