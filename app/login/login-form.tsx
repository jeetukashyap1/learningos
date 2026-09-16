"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthForm, AuthHeading, AuthNotice, AuthShell, AuthSubmit, AuthSwap, PasswordField, TextField } from "@/components/auth-form";
import { describeAuthError } from "@/lib/auth-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm({ next, linkError }: { next: string; linkError: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [formError, setFormError] = useState<string | null>(
    linkError ? "That sign-in link is no longer valid. Sign in with your email and password instead." : null,
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "loading") return;
    const issues: { email?: string; password?: string } = {};
    if (!email.trim()) issues.email = "Enter your email address to continue.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) issues.email = "That email address does not look right.";
    if (!password) issues.password = "Enter your password.";
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    setState("loading");
    setFormError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.session) {
        setFormError(describeAuthError(error ?? new Error("Sign-in did not complete. Please try again.")));
        setState("idle");
        return;
      }
      router.replace(next);
      router.refresh();
    } catch (error) {
      setFormError(describeAuthError(error));
      setState("idle");
    }
  }

  return <AuthShell brand={{ headline: "Your path picks up where you left it.", points: ["Your goal, skills, and next step stay in sync", "Practice tuned to what you are learning now", "Progress measured in capability, not hours"] }}>
    <AuthHeading eyebrow="WELCOME BACK" title="Sign in to LearningOS." description="Pick up the next meaningful step in your learning path." />
    {formError ? <AuthNotice tone="error">{formError}</AuthNotice> : null}
    <AuthForm onSubmit={handleSubmit}>
      <TextField id="login-email" label="Email address" type="email" placeholder="you@example.com" autoComplete="email" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} error={errors.email} />
      <PasswordField id="login-password" label="Password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} action={<Link href="/forgot-password" className="auth-link">Forgot password?</Link>} />
      <AuthSubmit state={state} label="Sign in" loadingLabel="Signing in…" />
    </AuthForm>
    <AuthSwap text="New to LearningOS?" linkLabel="Create your learning space" href="/signup" />
  </AuthShell>;
}
