"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { AuthNotice } from "@/components/auth-form";
import { describeAuthError } from "@/lib/auth-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const inputStyle = { display: "block", width: "100%", marginTop: 8, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper)", color: "var(--ink)" };

/**
 * Real editable profile fields. Only display name is editable here; email is
 * an account credential and changes through auth settings, not silently.
 */
export function ProfileDetailsForm({ initialName, email }: { initialName: string | null; email: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName ?? "");
  const [state, setState] = useState<"idle" | "saving">("idle");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "saving") return;
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
      // (Profile header + AppShell avatar/header) reflects the saved value
      // immediately, without a full page reload.
      router.refresh();
    } catch (error) {
      setError(describeAuthError(error));
      setState("idle");
    }
  }

  return <form className="card pad section" onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
    <div className="section-head"><div><div className="eyebrow">ABOUT YOU</div><h2 style={{ marginTop: 7 }}>Your details.</h2></div></div>
    {saved ? <AuthNotice tone="success">Display name saved.</AuthNotice> : null}
    {error ? <AuthNotice tone="error">{error}</AuthNotice> : null}
    <label style={{ fontSize: 12, fontWeight: 800 }}>Display name
      <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Your name" style={inputStyle} />
    </label>
    <label style={{ fontSize: 12, fontWeight: 800 }}>Email address
      <input value={email} readOnly type="email" disabled title="Email changes are handled in account settings" style={{ ...inputStyle, opacity: 0.6 }} />
    </label>
    <button className="btn btn-primary" type="submit" disabled={state === "saving"} style={{ justifySelf: "start" }}>
      <Save size={14} />{state === "saving" ? "Saving…" : "Save changes"}
    </button>
  </form>;
}
