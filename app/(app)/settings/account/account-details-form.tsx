"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { AuthNotice } from "@/components/auth-form";
import { describeAuthError } from "@/lib/auth-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const inputStyle = { display: "block", width: "100%", marginTop: 8, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper)", color: "var(--ink)" };

/**
 * Account settings form. Display name is editable (profiles table); email is
 * an account credential shown read-only; the learning goal comes from
 * onboarding and is edited by redoing onboarding.
 */
export function AccountDetailsForm({ initialName, email, learningGoal, signedIn }: { initialName: string | null; email: string; learningGoal: string | null; signedIn: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initialName ?? "");
  const [state, setState] = useState<"idle" | "saving">("idle");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "saving") return;
    if (!signedIn) {
      setError("Sign in to edit your details.");
      return;
    }
    if (!name.trim()) {
      setError("Display name cannot be empty.");
      setSaved(false);
      return;
    }
    setState("saving");
    setError(null);
    setSaved(false);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("Your session expired. Sign in again to save your details.");
        setState("idle");
        return;
      }
      const { error: updateError } = await supabase
        .from("profiles")
        .upsert({ id: user.id, full_name: name.trim() }, { onConflict: "id" });
      if (updateError) {
        setError(describeAuthError(updateError));
        setState("idle");
        return;
      }
      setSaved(true);
      setState("idle");
      // Re-run the server layout/page so the name resolved by getCurrentUser()
      // (this page + AppShell avatar/header) reflects the saved value
      // immediately, without a full page reload.
      router.refresh();
    } catch (error) {
      setError(describeAuthError(error));
      setState("idle");
    }
  }

  return <form className="card pad" style={{ marginTop: 28, display: "grid", gap: 16 }} onSubmit={handleSubmit}>
    {saved ? <AuthNotice tone="success">Changes saved.</AuthNotice> : null}
    {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}
    <label style={{ fontSize: 12, fontWeight: 800 }}>Display name
      <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Your name" disabled={!signedIn} style={inputStyle} />
    </label>
    <label style={{ fontSize: 12, fontWeight: 800 }}>Email address
      <input value={email || "—"} readOnly type="email" disabled title="Email changes are handled by support in this phase" style={{ ...inputStyle, opacity: 0.6 }} />
    </label>
    <label style={{ fontSize: 12, fontWeight: 800 }}>Learning goal
      <input value={learningGoal ?? ""} readOnly disabled title="Set during onboarding" placeholder={signedIn ? "Set your goal in onboarding" : "Sign in to see your goal"} style={{ ...inputStyle, opacity: 0.6 }} />
    </label>
    {signedIn && !learningGoal ? <p className="muted" style={{ fontSize: 12 }}>No learning goal yet — <Link href="/onboarding" className="auth-link">complete onboarding</Link> to set one.</p> : null}
    <button className="btn btn-primary" type="submit" disabled={state === "saving" || !signedIn} style={{ justifySelf: "start" }}>
      <Save size={14} />{state === "saving" ? "Saving…" : "Save changes"}
    </button>
  </form>;
}
