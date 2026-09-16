"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";

/**
 * Split auth layout: brand statement on the left (desktop only),
 * form panel on the right. Stacks on mobile.
 */
export function AuthShell({ brand, children }: { brand: { headline: string; points: string[] }; children: ReactNode }) {
  return <main className="auth-shell">
    <aside className="auth-brand" aria-hidden="true">
      <Link className="brand" href="/" tabIndex={-1}><span className="brand-mark" />LearningOS</Link>
      <div className="auth-brand-copy">
        <h2>{brand.headline}</h2>
        <ul className="auth-brand-points">
          {brand.points.map((point) => <li key={point}><Check size={15} aria-hidden="true" />{point}</li>)}
        </ul>
      </div>
      <p className="auth-brand-foot">Built for deliberate learning.</p>
    </aside>
    <section className="auth-panel">
      <div className="auth-panel-inner">
        <Link className="brand" href="/"><span className="brand-mark" />LearningOS</Link>
        {children}
      </div>
      <footer className="auth-footer">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/help">Help</Link>
      </footer>
    </section>
  </main>;
}

export function AuthHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="auth-heading">
    <div className="eyebrow">{eyebrow}</div>
    <h1>{title}</h1>
    <p className="muted">{description}</p>
  </header>;
}

export function AuthForm({ onSubmit, children, noValidate = true }: { onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; children: ReactNode; noValidate?: boolean }) {
  return <form className="auth-form" onSubmit={onSubmit} noValidate={noValidate}>{children}</form>;
}

type FieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
};

export function TextField({ id, label, error, hint, ...input }: FieldProps) {
  return <div className="auth-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} className={error ? "auth-input has-error" : "auth-input"} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...input} />
    {hint && !error ? <p className="auth-hint" id={`${id}-hint`}>{hint}</p> : null}
    {error ? <p className="auth-error" id={`${id}-error`} role="alert">{error}</p> : null}
  </div>;
}

export function PasswordField({ id, label, error, hint, action, ...input }: FieldProps & { action?: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return <div className="auth-field">
    <div className="auth-field-row">
      <label htmlFor={id}>{label}</label>
      {action}
    </div>
    <div className="auth-input-wrap">
      <input id={id} type={visible ? "text" : "password"} className={error ? "auth-input has-error" : "auth-input"} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} {...input} />
      <button type="button" className="auth-toggle" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>
        {visible ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
      </button>
    </div>
    {hint && !error ? <p className="auth-hint" id={`${id}-hint`}>{hint}</p> : null}
    {error ? <p className="auth-error" id={`${id}-error`} role="alert">{error}</p> : null}
  </div>;
}

export function AuthSubmit({ state, label, loadingLabel }: { state: "idle" | "loading"; label: string; loadingLabel: string }) {
  const loading = state === "loading";
  return <button type="submit" className="btn btn-dark auth-submit" disabled={loading} aria-busy={loading}>
    {loading ? <><Loader2 size={15} className="auth-spinner" aria-hidden="true" />{loadingLabel}</> : label}
  </button>;
}

/**
 * Post-submit notice for auth forms: info, success, or error feedback.
 */
export function AuthNotice({ tone = "info", children }: { tone?: "info" | "success" | "error"; children: ReactNode }) {
  const className = tone === "success" ? "auth-notice success" : tone === "error" ? "auth-notice error" : "auth-notice";
  return <div className={className} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function AuthSwap({ text, linkLabel, href }: { text: string; linkLabel: string; href: string }) {
  return <p className="auth-swap">{text} <Link href={href}>{linkLabel}</Link></p>;
}
