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

/**
 * Auth pages a signed-in user should be bounced away from. /forgot-password
 * and /reset-password are intentionally excluded so a recovery session can
 * reach the reset form without being sent to the dashboard.
 */
const AUTH_PAGES = ["/login", "/signup"] as const;

/** The dedicated password-recovery page. */
const RESET_PASSWORD_PATH = "/reset-password";

/** Pages that own the auth/recovery flow and must never be re-forwarded. */
const AUTH_SURFACE_PATHS = [...AUTH_PAGES, RESET_PASSWORD_PATH, "/forgot-password", "/auth/callback"] as const;

/** Query keys Supabase uses for out-of-browser auth links. */
const AUTH_LINK_PARAMS = ["code", "token_hash", "type", "error", "error_code"] as const;

/** Reject protocol-relative (`//evil.com`) and absolute URLs. */
function isSafeRelativePath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("://");
}

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isAuthPage(pathname: string): boolean {
  return (AUTH_PAGES as readonly string[]).includes(pathname);
}

/**
 * Refreshes the Supabase session cookie and enforces route protection.
 * - Stray Supabase auth links (`code`, `token_hash`, recovery errors) are
 *   forwarded to /auth/callback so PKCE/OTP exchanges always run, even when a
 *   project's redirect URL points at the site root or another page.
 * - Unauthenticated visits to protected routes redirect to /login?next=<path>
 *   so the destination is preserved and restored right after login.
 * - Authenticated visits to /login or /signup redirect to /dashboard.
 * - A signed-in visitor who is not on an auth surface is confined to
 *   /reset-password until the password has been changed, so a recovery
 *   session can never be treated as a normal application session.
 * - No redirect loops: auth-surface pages are excluded from forwarding,
 *   /login and /reset-password are not protected, and /dashboard needs auth.
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

  // Supabase emails normally redirect to /auth/callback, but a project whose
  // Site URL / redirect list is misconfigured can land a recovery or
  // confirmation link on the root or another page. Forward those links to the
  // callback (query preserved) so the code/token is still exchanged.
  if (!(AUTH_SURFACE_PATHS as readonly string[]).includes(pathname)) {
    const hasAuthLinkParam = AUTH_LINK_PARAMS.some((key) => request.nextUrl.searchParams.has(key));
    if (hasAuthLinkParam) {
      const callbackUrl = request.nextUrl.clone();
      callbackUrl.pathname = "/auth/callback";
      return NextResponse.redirect(callbackUrl);
    }
  }

  if (!user && isProtectedRoute(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  // A recovery session must not behave like a normal sign-in. Until a new
  // password is chosen the visitor may only see the reset page, plus the
  // callback and forgot-password hand-off that establish the session.
  if (user && pathname !== RESET_PASSWORD_PATH) {
    const next = request.nextUrl.searchParams.get("next");
    const isRecoveryReturn =
      pathname === "/auth/callback" ||
      (pathname === "/forgot-password" && next !== null && isSafeRelativePath(next));
    if (isRecoveryReturn) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = RESET_PASSWORD_PATH;
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }
  }

  if (user && isAuthPage(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
