"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthForm, AuthHeading, AuthNotice, AuthShell, AuthSubmit, AuthSwap, PasswordField, TextField } from "@/components/auth-form";
import { describeAuthError } from "@/lib/auth-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "loading") return;
    const issues: { name?: string; email?: string; password?: string } = {};
    if (!name.trim()) issues.name = "Tell us what to call you.";
    if (!email.trim()) issues.email = "Enter your email address to continue.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) issues.email = "That email address does not look right.";
    if (!password) issues.password = "Choose a password.";
    else if (password.length < 8) issues.password = "Use at least 8 characters.";
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    setState("loading");
    setFormError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: name.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
        },
      });
      if (error || !data.user) {
        setFormError(describeAuthError(error ?? new Error("Sign-up did not complete. Please try again.")));
        setState("idle");
        return;
      }
      if (data.session) {
        // Email confirmation is disabled on this project: session is live.
        router.replace("/onboarding");
        router.refresh();
        return;
      }
      router.replace(`/verify-email?email=${encodeURIComponent(email.trim())}`);
    } catch (error) {
      setFormError(describeAuthError(error));
      setState("idle");
    }
  }

  return <AuthShell brand={{ headline: "A clear path from day one.", points: ["Start with your goal, not a course catalog", "Lessons, practice, and projects in one route", "Built for small, consistent sessions"] }}>
    <AuthHeading eyebrow="CREATE YOUR LEARNING SPACE" title="Start with intention." description="Tell us what you want to learn. Your space starts empty and grows around your goal — no sample data, no noise." />
    {formError ? <AuthNotice tone="error">{formError}</AuthNotice> : null}
    <AuthForm onSubmit={handleSubmit}>
      <TextField id="signup-name" label="Your name" placeholder="Alex Morgan" autoComplete="name" autoFocus value={name} onChange={(event) => setName(event.target.value)} error={errors.name} />
      <TextField id="signup-email" label="Email address" type="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={errors.email} />
      <PasswordField id="signup-password" label="Password" autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} hint="Use at least 8 characters." />
      <AuthSubmit state={state} label="Create learning space" loadingLabel="Creating your space…" />
    </AuthForm>
    <p className="auth-legal">By creating an account you agree to our <Link href="/terms" className="auth-link">Terms</Link> and <Link href="/privacy" className="auth-link">Privacy Policy</Link>.</p>
    <AuthSwap text="Already learning with us?" linkLabel="Sign in" href="/login" />
  </AuthShell>;
}
