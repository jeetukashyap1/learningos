import Link from "next/link";
import { MailCheck } from "lucide-react";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ email?: string | string[] }> }) {
  const params = await searchParams;
  const raw = Array.isArray(params.email) ? params.email[0] : params.email;
  const email = typeof raw === "string" ? raw.trim() : "";
  return <main className="container"><div style={{ maxWidth: 460, margin: "80px auto", textAlign: "center" }}><div className="move-icon" style={{ margin: "0 auto", background: "var(--mint)", color: "var(--ink)" }}><MailCheck size={24} /></div><h1 style={{ fontSize: "clamp(28px, 8vw, 38px)", marginTop: 24 }}>Check your inbox.</h1><p className="muted" style={{ lineHeight: 1.7, marginTop: 14 }}>{email ? <span>We sent a confirmation link to <strong style={{ wordBreak: "break-all" }}>{email}</strong>. Open it to activate your account, then sign in.</span> : "Open the confirmation link we sent you to activate your account, then sign in."}</p><Link href="/login" className="btn btn-dark" style={{ marginTop: 24 }}>Back to sign in</Link></div></main>;
}
