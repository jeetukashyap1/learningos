"use client";

/**
 * The path library list (spec parts 16-17): one card per persisted path
 * with its real lesson and completion counts, the active-path switch, and
 * the honest per-card states. All data comes from listLearningPaths();
 * the switch calls POST /api/learning/paths/active and lets the server
 * re-render every page against the newly active path.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2, Route } from "lucide-react";
import type { LearningPathListItem } from "@/lib/learning-path/service";

/** Friendly labels for the persisted domain values (spec part 8). */
const DOMAIN_LABELS: Record<string, string> = {
  academic: "Academic",
  programming: "Programming",
  language: "Language learning",
  "exam-prep": "Exam preparation",
  creative: "Creative",
  practical: "Practical skill",
  other: "General",
};

/** Video-language labels (spec part 6), shown where they help the learner. */
const LANGUAGE_LABELS: Record<string, string> = {
  en: "English videos",
  hi: "Hindi videos",
  hinglish: "Hinglish videos",
  any: "Any language",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Deterministic date formatting: identical on server and client render. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Extracts the safe message the API routes put in { error: string }. */
function safeApiError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const message = (body as { error?: unknown }).error;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

export function PathLibrary({ paths }: { paths: LearningPathListItem[] }) {
  const router = useRouter();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(pathId: string) {
    if (switchingId) return;
    setSwitchingId(pathId);
    setError(null);
    try {
      const response = await fetch("/api/learning/paths/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(safeApiError(body, "We could not switch your path. Please try again."));
        return;
      }
      // Every page reads the active path server-side, so a refresh makes
      // the whole app operate on the newly selected path (spec part 16).
      router.push("/journey");
      router.refresh();
    } catch {
      setError("We could not reach LearningOS while switching paths. Check your connection and try again.");
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && (
        <div className="card pad" role="alert" style={{ display: "grid", gap: 6, borderColor: "var(--orange)" }}>
          <strong style={{ fontSize: 13 }}>Switch paused</strong>
          <p className="muted" style={{ fontSize: 13 }}>{error}</p>
        </div>
      )}

      {paths.map((path) => {
        const percent = path.lessonCount === 0 ? 0 : Math.round((path.completedLessonCount / path.lessonCount) * 100);
        const meta = [
          DOMAIN_LABELS[path.domain] ?? "Learning",
          LANGUAGE_LABELS[path.videoLanguage] ?? "",
          formatDate(path.createdAt),
        ].filter(Boolean).join(" · ");
        return (
          <article key={path.id} className="card pad" style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow" style={{ color: path.isActive ? "var(--orange)" : undefined }}>
                  {path.isActive ? "CURRENT PATH" : "IN YOUR LIBRARY"}
                </div>
                <h2 style={{ fontSize: 22, marginTop: 10 }}>{path.title}</h2>
                <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>{meta}</p>
              </div>
              {path.isActive ? (
                <Link href="/journey" className="btn btn-primary">Continue<ArrowRight size={14} /></Link>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => void switchTo(path.id)} disabled={switchingId !== null}>
                  {switchingId === path.id ? <Loader2 size={14} className="auth-spinner" /> : <Route size={14} />}
                  Switch to this path
                </button>
              )}
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                <span className="muted">{path.completedLessonCount} of {path.lessonCount} lessons complete</span>
                <strong>{percent}%</strong>
              </div>
              <div
                style={{ height: 8, borderRadius: 6, background: "var(--line)", overflow: "hidden" }}
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${path.title}: ${percent}% complete`}
              >
                <div style={{ width: `${percent}%`, height: "100%", background: "var(--orange)" }} />
              </div>
            </div>
          </article>
        );
      })}

      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
        Switching changes every page — journey, lessons, practice, and progress all follow your active path. Your other paths keep their own lessons and progress exactly as you left them.
      </p>
    </div>
  );
}
