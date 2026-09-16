"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { AuthNotice } from "@/components/auth-form";
import { describeAuthError } from "@/lib/auth-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const inputStyle = { display: "block", width: "100%", marginTop: 8, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--paper)", color: "var(--ink)" };

export default function SecurityPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwState, setPwState] = useState<"idle" | "saving">("idle");
  const [pwSaved, setPwSaved] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function handleChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pwState === "saving") return;
    const issues: string[] = [];
    if (password.length < 8) issues.push("Use at least 8 characters.");
    if (password !== confirm) issues.push("The two passwords do not match.");
    if (issues.length > 0) {
      setPwError(issues.join(" "));
      setPwSaved(false);
      return;
    }
    setPwState("saving");
    setPwError(null);
    setPwSaved(false);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setPwError(describeAuthError(error));
        setPwState("idle");
        return;
      }
      setPwSaved(true);
      setPassword("");
      setConfirm("");
      setPwState("idle");
    } catch (error) {
      setPwError(describeAuthError(error));
      setPwState("idle");
    }
  }

  async function handleSignOutEverywhere() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await getSupabaseBrowserClient().auth.signOut({ scope: "global" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return <main className="container">
    <Link href="/settings" className="muted" style={{ fontSize: 12, fontWeight: 800 }}>← Settings</Link>
    <div style={{ maxWidth: 720, margin: "30px auto" }}>
      <div className="eyebrow">SECURITY</div>
      <h1 style={{ marginTop: 12 }}>Protect your learning space.</h1>
      <div className="grid" style={{ marginTop: 28 }}>
        <div className="card pad">
          <ShieldCheck size={20} color="#5d963f" />
          <h3 style={{ marginTop: 16 }}>Account protection</h3>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginTop: 7 }}>Choose a new password for your account. You stay signed in on this device.</p>
          {pwSaved ? <AuthNotice tone="success">Password updated. Use your new password next time you sign in.</AuthNotice> : null}
          {pwError ? <AuthNotice tone="error">{pwError}</AuthNotice> : null}
          <form onSubmit={handleChangePassword} style={{ display: "grid", gap: 14, marginTop: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 800 }}>New password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="At least 8 characters" style={inputStyle} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 800 }}>Confirm new password
              <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" placeholder="Repeat your new password" style={inputStyle} />
            </label>
            <button className="btn btn-dark" type="submit" disabled={pwState === "saving"} style={{ justifySelf: "start" }}>
              <KeyRound size={14} />{pwState === "saving" ? "Updating…" : "Change password"}
            </button>
          </form>
        </div>
        <div className="card pad">
          <h3>Active sessions</h3>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginTop: 7 }}>This device · Active now. Signing out everywhere ends your session on every device and browser.</p>
          <button className="btn btn-ghost" type="button" onClick={handleSignOutEverywhere} disabled={signingOut} style={{ marginTop: 15 }}>
            <LogOut size={14} />{signingOut ? "Signing out…" : "Sign out everywhere"}
          </button>
        </div>
      </div>
    </div>
  </main>;
}
