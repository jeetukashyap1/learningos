"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthForm, AuthHeading, AuthNotice, AuthShell, AuthSubmit, AuthSwap, PasswordField } from "@/components/auth-form";
import { describeAuthError } from "@/lib/auth-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // A password reset link lands here through /auth/callback, which exchanges
  // the recovery code for a session first. Direct visits without a session
  // show an honest expired-link state instead of a form that cannot succeed.
  const [sessionState, setSessionState] = useState<"checking" | "valid" | "missing">("checking");

  useEffect(() => {
    let active = true;
    getSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data }) => {
        if (active) setSessionState(data.session ? "valid" : "missing");
      })
      .catch(() => {
        if (active) setSessionState("missing");
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "loading") return;
    const issues: { password?: string; confirm?: string } = {};
    if (!password) issues.password = "Choose a new password.";
    else if (password.length < 8) issues.password = "Use at least 8 characters.";
    if (!confirm) issues.confirm = "Repeat your new password.";
    else if (password !== confirm) issues.confirm = "The two passwords do not match.";
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    setState("loading");
    setFormError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(describeAuthError(error));
        setState("idle");
        return;
      }
      setSaved(true);
      setState("idle");
    } catch (error) {
      setFormError(describeAuthError(error));
      setState("idle");
    }
  }

  return <AuthShell brand={{ headline: "A fresh password, a familiar path.", points: ["Pick something you have not used before", "Your learning progress is untouched", "You will be signed in again right after"] }}>
    <AuthHeading eyebrow="ACCOUNT RECOVERY" title="Choose a new password." description="Pick a strong password you have not used elsewhere. Your learning path will be waiting exactly as you left it." />
    {saved ? <div className="auth-notice success" role="status">
      <strong>Password updated.</strong>
      <p>Your new password is ready to use. You are signed in — continue to your learning path.</p>
      <Link href="/dashboard" className="btn btn-dark" style={{ marginTop: 12, display: "inline-block" }}>Go to dashboard</Link>
    </div> : sessionState === "checking" ? <p className="muted">Checking your reset link…</p> : sessionState === "missing" ? <AuthNotice tone="error">
      This reset link has expired or was already used. Request a new one from the <Link href="/forgot-password" className="auth-link">password reset page</Link>.
    </AuthNotice> : <>
      {formError ? <AuthNotice tone="error">{formError}</AuthNotice> : null}
      <AuthForm onSubmit={handleSubmit}>
        <PasswordField id="reset-password" label="New password" autoComplete="new-password" placeholder="At least 8 characters" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} hint="Use at least 8 characters." />
        <PasswordField id="reset-confirm" label="Confirm new password" autoComplete="new-password" placeholder="Repeat your new password" value={confirm} onChange={(event) => setConfirm(event.target.value)} error={errors.confirm} />
        <AuthSubmit state={state} label="Update password" loadingLabel="Updating…" />
      </AuthForm>
    </>}
    <AuthSwap text="Back to" linkLabel="sign in" href="/login" />
  </AuthShell>;
}
