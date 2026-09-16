"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Client island for the journey page: retries video attachment for
 * lessons still in 'pending' by calling the attach API - the same
 * endpoint the onboarding flow uses. One real request, no timers; the
 * page refreshes only after the request actually finishes. Retrying is
 * safe and idempotent (spec parts 10, 15, 16): lessons that already
 * have a video keep it, and only pending lessons are searched again.
 */
export function RetryVideosButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/learning/paths/attach", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(extractError(body, "We could not load videos for your lessons. Please try again."));
        return;
      }
      // The reloaded page shows the real result: pending lessons become
      // found or unavailable, and this banner disappears once nothing is
      // pending anymore.
      router.refresh();
    } catch {
      setError("We could not reach LearningOS. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button type="button" className="btn btn-ghost" onClick={() => void retry()} disabled={busy} aria-busy={busy}>
        {busy ? <><Loader2 size={14} className="auth-spinner" />Finding videos</> : "Retry videos"}
      </button>
      {error && <small className="muted" role="alert" style={{ fontSize: 12 }}>{error}</small>}
    </span>
  );
}

function extractError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}
