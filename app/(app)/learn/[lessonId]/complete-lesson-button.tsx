"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RotateCcw } from "lucide-react";

/**
 * Client island for the real lesson view: marks the lesson complete (or
 * not complete) through the existing completion API. completed_at is the
 * single progress signal - there is no second progress system (spec
 * parts 13-14). One real request per click; the page refreshes only
 * after the database actually changed.
 */
export function CompleteLessonButton({ lessonId, completed }: { lessonId: string; completed: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/learning/lessons/${lessonId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: next }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(extractError(body, "We could not save your progress. Please try again."));
        return;
      }
      router.refresh();
    } catch {
      setError("We could not reach LearningOS. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (completed) {
    return (
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "end" }}>
        <span className="tag" data-completed="true"><Check size={12} />Completed</span>
        <button type="button" className="btn btn-ghost" onClick={() => void update(false)} disabled={busy} aria-busy={busy}>
          {busy ? <Loader2 size={14} className="auth-spinner" /> : <RotateCcw size={14} />}Mark as not done
        </button>
        {error && <small className="muted" role="alert" style={{ fontSize: 12, width: "100%", textAlign: "end" }}>{error}</small>}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
      <button type="button" className="btn btn-primary" onClick={() => void update(true)} disabled={busy} aria-busy={busy}>
        {busy ? <><Loader2 size={14} className="auth-spinner" />Saving</> : <>Mark lesson complete<Check size={14} /></>}
      </button>
      {error && <small className="muted" role="alert" style={{ fontSize: 12 }}>{error}</small>}
    </div>
  );
}

function extractError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return fallback;
}
