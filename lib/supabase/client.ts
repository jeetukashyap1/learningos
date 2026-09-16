import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

let cachedBrowserClient: SupabaseClient | undefined;

/**
 * The single Supabase client for client components. One instance is shared
 * across the app so auth state, realtime subscriptions, and cookies stay in
 * sync. Server code must use lib/supabase/server.ts instead.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (!cachedBrowserClient) {
    const { url, anonKey } = getSupabaseEnv();
    cachedBrowserClient = createBrowserClient(url, anonKey);
  }
  return cachedBrowserClient;
}
