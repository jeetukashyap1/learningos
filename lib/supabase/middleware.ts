import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

/**
 * Routes that require an authenticated session.
 * The demo cookie never grants access to these routes.
 */
export const PROTECTED_ROUTE_PREFIXES = [
  "/dashboard",
  "/journey",
  "/skills",
  "/quick-learn",
  "/learn",
  "/practice",
  "/challenges",
  "/projects",
  "/progress",
  "/ai-tutor",
  "/notifications",
  "/profile",
  "/settings",
  "/onboarding",
] as const;

/** Auth pages a signed-in user should be bounced away from. */
const AUTH_PAGES = ["/login", "/signup"] as const;

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Refreshes the Supabase session cookie and enforces route protection.
 * - Unauthenticated visits to protected routes redirect to /login?next=<path>
 *   so the destination is preserved and restored right after login.
 * - Authenticated visits to /login or /signup redirect to /dashboard.
 * - No redirect loops: /login is not protected and /dashboard requires auth.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  // getUser() revalidates the session with the Supabase server instead of
  // trusting the JWT in the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && isProtectedRoute(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && (AUTH_PAGES as readonly string[]).includes(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
