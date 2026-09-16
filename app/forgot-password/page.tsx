"use client";

import { useState } from "react";
import { AuthForm, AuthHeading, AuthNotice, AuthShell, AuthSubmit, AuthSwap, TextField } from "@/components/auth-form";
import { describeAuthError } from "@/lib/auth-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ email?: string }>({});
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "loading") return;
    const issues: { email?: string } = {};
    if (!email.trim()) issues.email = "Enter the email address on your account.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) issues.email = "That email address does not look right.";
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    setState("loading");
    setFormError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (error) {
        setFormError(describeAuthError(error));
        setState("idle");
        return;
      }
      setSent(true);
      setState("idle");
    } catch (error) {
      setFormError(describeAuthError(error));
      setState("idle");
    }
  }

  return <AuthShell brand={{ headline: "Locked out is temporary.", points: ["A secure reset link, sent to your inbox", "Your learning path stays exactly as you left it", "Password reset expires for your safety"] }}>
    <AuthHeading eyebrow="ACCOUNT RECOVERY" title="Reset your password." description="Enter your email and we will prepare a secure reset link." />
    {sent ? <div className="auth-notice success" role="status">
      <strong>Check your inbox.</strong>
      <p>If an account exists for {email.trim()}, a reset link is on its way. The link expires in 60 minutes.</p>
    </div> : <>
      {formError ? <AuthNotice tone="error">{formError}</AuthNotice> : null}
      <AuthForm onSubmit={handleSubmit}>
        <TextField id="forgot-email" label="Email address" type="email" placeholder="you@example.com" autoComplete="email" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} error={errors.email} />
        <AuthSubmit state={state} label="Send reset link" loadingLabel="Sending…" />
      </AuthForm>
    </>}
    <AuthSwap text="Remembered it after all?" linkLabel="Back to sign in" href="/login" />
  </AuthShell>;
}
