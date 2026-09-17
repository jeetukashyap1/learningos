"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Loader2 } from "lucide-react";

/**
 * One real notification row.
 *
 * The signal content is derived on the server (never stored), and its READ
 * state is passed in from the persisted notification_reads table. Opening a
 * signal marks it read through the notifications API, then navigates to the
 * signal's target. The read state is persisted BEFORE navigating, so the
 * next render (and any later refresh or re-login) shows the signal as read.
 *
 * Read vs unread is the only visual difference, and it follows the existing
 * design language: unread keeps the mint icon and the small orange dot;
 * read uses the quiet paper icon and shows a small "Read" tag with a tick.
 * The check never appears on an unread signal.
 */
export function NotificationRow({
  signalKey,
  title,
  detail,
  kind,
  href,
  read,
}: {
  signalKey: string;
  title: string;
  detail: string;
  kind: string;
  href: string;
  read: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    // Already read: nothing to persist, just go where the signal points.
    if (read) {
      router.push(href);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/learning/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: signalKey }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(extractError(body, "We could not save your notification state. Please try again."));
        return;
      }
      // Persisted. Invalidate the router cache BEFORE navigating so the
      // destination renders the fresh shell indicator (the shared layout)
      // instead of a cached one that still shows the unread dot.
      router.refresh();
      router.push(href);
    } catch {
      setError("We could not reach LearningOS. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="list-row">
      <div className="move-icon" style={{ background: read ? "var(--paper)" : "var(--mint)", color: "var(--ink)" }}>
        <Bell size={18} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13 }}>{title}</strong>
          {!read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--orange)" }} aria-hidden="true" />}
          <span className="tag">{kind}</span>
          {read && <span className="tag" data-read="true"><Check size={12} />Read</span>}
        </div>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 5 }}>{detail}</p>
        {error && <small className="muted" role="alert" style={{ fontSize: 11, display: "block", marginTop: 5 }}>{error}</small>}
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 11, padding: "8px 12px", flexShrink: 0 }}
        onClick={() => void open()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? <Loader2 size={13} className="auth-spinner" /> : null}Open
      </button>
    </article>
  );
}

function extractError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}
