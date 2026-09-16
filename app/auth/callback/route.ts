import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Supabase auth callback endpoint.
 *
 * Supabase redirects here after out-of-browser actions (email confirmation,
 * password recovery, OAuth) with a one-time `code` query parameter. The code
 * is exchanged for a session — cookies are written through the server client —
 * and the visitor is sent on to the validated destination.
 */

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Missing or unusable code: land on login with an error flag the form shows.
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("error", "link");
  return NextResponse.redirect(loginUrl);
}
