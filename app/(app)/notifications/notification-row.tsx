"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Loader2 } from "lucide-react";
import { useNotificationReadSync } from "@/components/user-state-provider";

/**
 * One real notification row.
 *
 * The signal content is derived on the server (never stored), and its READ
 * state is passed in from the persisted notification_reads table. Opening a
 * signal marks it read through the notifications API, then navigates to the
 * signal's target. The write lands in Supabase first - notification_reads
 * stays the source of truth - and the row clears its own unread marking the
 * moment that write succeeds, so the orange dot disappears on the click
 * itself. The shared unread count drops at the same time, so the sidebar dot
 * follows immediately without a refresh or a page reload.
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
  const { markSignalRead } = useNotificationReadSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic read state for this session: set as soon as the mark-read
  // write lands, so the row never keeps showing the orange dot while it waits
  // for a server re-render. Any later render still reads the persisted
  // notification_reads row, so the server value stays authoritative.
  const [locallyRead, setLocallyRead] = useState(false);
  const isRead = read || locallyRead;

  async function open() {
    // Already read: nothing to persist, just go where the signal points.
    if (isRead) {
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
      // Persisted in notification_reads. Apply the read transition locally
      // instead of relying on a router.refresh() that the navigation below
      // would supersede: the row drops its own unread marking and the shared
      // unread count drops with it, so the dot clears on the same click.
      setLocallyRead(true);
      markSignalRead();
      router.push(href);
    } catch {
      setError("We could not reach LearningOS. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="list-row">
      <div className="move-icon" style={{ background: isRead ? "var(--paper)" : "var(--mint)", color: "var(--ink)" }}>
        <Bell size={18} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13 }}>{title}</strong>
          {!isRead && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--orange)" }} aria-hidden="true" />}
          <span className="tag">{kind}</span>
          {isRead && <span className="tag" data-read="true"><Check size={12} />Read</span>}
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
