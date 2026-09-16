"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthForm, AuthHeading, AuthNotice, AuthShell, AuthSubmit, AuthSwap, PasswordField } from "@/components/auth-form";
import { describeAuthError } from "@/lib/auth-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Seconds to wait after a successful change before returning to /login. */
const REDIRECT_SECONDS = 5;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [submitState, setSubmitState] = useState<"idle" | "loading">("idle");
  const [formError, setFormError] = useState<string | null>(null);
  // A recovery link lands here through /auth/callback, which exchanges the
  // recovery credential for a session first. Direct visits without a session
  // show an honest expired-link state instead of a form that cannot succeed.
  const [state, setState] = useState<"checking" | "valid" | "missing" | "done">("checking");
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    let active = true;
    // The callback flags an unusable link with ?error=link.
    const hasLinkError = new URLSearchParams(window.location.search).has("error");
    getSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data }) => {
        if (!active) return;
        setState(hasLinkError || !data.session ? "missing" : "valid");
      })
      .catch(() => {
        if (active) setState("missing");
      });
    return () => {
      active = false;
    };
  }, []);

  // After a successful change the recovery session is closed and the visitor
  // returns to /login to sign in with the new password.
  useEffect(() => {
    if (state !== "done") return;
    if (countdown <= 0) {
      router.replace("/login");
      return;
    }
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [state, countdown, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitState === "loading") return;
    const issues: { password?: string; confirm?: string } = {};
    if (!password) issues.password = "Choose a new password.";
    else if (password.length < 8) issues.password = "Use at least 8 characters.";
    if (!confirm) issues.confirm = "Repeat your new password.";
    else if (password !== confirm) issues.confirm = "The two passwords do not match.";
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    setSubmitState("loading");
    setFormError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(describeAuthError(error));
        setSubmitState("idle");
        return;
      }
      // A recovery session must not survive as a normal application session:
      // end it before sending the visitor back to sign in with the new password.
      await supabase.auth.signOut();
      setSubmitState("idle");
      setCountdown(REDIRECT_SECONDS);
      setState("done");
    } catch (error) {
      setFormError(describeAuthError(error));
      setSubmitState("idle");
    }
  }

  return <AuthShell brand={{ headline: "A fresh password, a familiar path.", points: ["Pick something you have not used before", "Your learning progress is untouched", "Sign in with your new password when you are ready"] }}>
    <AuthHeading eyebrow="ACCOUNT RECOVERY" title="Choose a new password." description="Pick a strong password you have not used elsewhere. Your learning path will be waiting exactly as you left it." />
    {state === "done" ? <div className="auth-notice success" role="status">
      <strong>Password updated.</strong>
      <p>Your new password is ready. Returning you to sign in in {countdown}s.</p>
      <Link href="/login" className="btn btn-dark" style={{ marginTop: 12, display: "inline-block" }}>Continue to login</Link>
    </div> : state === "checking" ? <p className="muted">Checking your reset link…</p> : state === "missing" ? <AuthNotice tone="error">
      This reset link has expired or was already used. Request a new one from the <Link href="/forgot-password" className="auth-link">password reset page</Link>.
    </AuthNotice> : <>
      {formError ? <AuthNotice tone="error">{formError}</AuthNotice> : null}
      <AuthForm onSubmit={handleSubmit}>
        <PasswordField id="reset-password" label="New password" autoComplete="new-password" placeholder="At least 8 characters" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} hint="Use at least 8 characters." />
        <PasswordField id="reset-confirm" label="Confirm new password" autoComplete="new-password" placeholder="Repeat your new password" value={confirm} onChange={(event) => setConfirm(event.target.value)} error={errors.confirm} />
        <AuthSubmit state={submitState} label="Update password" loadingLabel="Updating…" />
      </AuthForm>
    </>}
    <AuthSwap text="Back to" linkLabel="sign in" href="/login" />
  </AuthShell>;
}
