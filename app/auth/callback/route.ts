import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Supabase auth callback endpoint.
 *
 * Supabase redirects here after out-of-browser actions (email confirmation,
 * password recovery, OAuth) with a one-time credential that is turned into a
 * cookie-backed session. Two link shapes are supported:
 *
 *  - PKCE links (the default flow) carry a `code` query parameter that is
 *    exchanged for a session.
 *  - Token links carry `token_hash` + `type` and are verified directly. The
 *    recovery email template must use `{{ .TokenHash }}` (and `type=recovery`)
 *    for this path to be exercised.
 *
 * Recovery requests are always sent to the dedicated /reset-password page so a
 * recovery session can never be forwarded to the generic app/dashboard as if
 * it were a normal sign-in.
 */

const RECOVERY_PATH = "/reset-password";

const OTP_TYPES = ["signup", "invite", "magiclink", "recovery", "email_change", "email"] as const;

type OtpType = (typeof OTP_TYPES)[number];

function parseOtpType(value: string | null): OtpType | null {
  return value && (OTP_TYPES as readonly string[]).includes(value) ? (value as OtpType) : null;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = parseOtpType(searchParams.get("type"));

  // Recovery links set type=recovery; the reset email also targets this route
  // with next=/reset-password. Either signal is enough to treat the link as a
  // password recovery, and recovery never falls back to the dashboard.
  const nextParam = searchParams.get("next");
  const isRecovery = otpType === "recovery" || nextParam === RECOVERY_PATH;
  const destination = isRecovery ? RECOVERY_PATH : safeNextPath(nextParam);

  if (code || (tokenHash && otpType)) {
    const supabase = await createSupabaseServerClient();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(new URL(destination, origin));
      }
    } else if (tokenHash && otpType) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
      if (!error) {
        return NextResponse.redirect(new URL(destination, origin));
      }
    }
  }

  // Missing or unusable credential. Recovery links return to the reset page
  // with an explicit error flag it renders; everything else lands on login.
  const failureUrl = new URL(isRecovery ? RECOVERY_PATH : "/login", origin);
  failureUrl.searchParams.set("error", "link");
  return NextResponse.redirect(failureUrl);
}
