/**
 * LearningResources: client component that searches YouTube learning videos
 * through the server-side API route and renders the ranked results.
 *
 * Why client-side: the parent lesson/skill pages already ship client
 * components driven by useUserState(); fetching on mount keeps the frozen
 * page layouts untouched while adding a self-contained section.
 *
 * Error/empty states (all using existing design tokens, no new CSS):
 * - loading, no results, invalid query (400), not signed in (401),
 *   missing API key / quota exhausted (503), YouTube unavailable (502/503),
 *   unexpected errors (500), and network failures.
 */

"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Lightbulb, Play, SearchX, Sparkles, Youtube } from "lucide-react";
import { YouTubeEmbed } from "@/components/youtube-embed";

export interface LearningResourceResult {
  id: string | null;
  type: string;
  provider: string;
  externalId: string;
  title: string;
  description: string;
  url: string;
  thumbnailUrl: string;
  channelName: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  status: string;
  relevanceScore: number;
  scoreBreakdown: { topicMatch: number; titleMatch: number; descriptionMatch: number; educationalSignals: number; durationFit: number; levelFit: number };
}

export interface LearningResourcesProps {
  /** Free-text search term (e.g. the lesson's concept). */
  query: string;
  /** Optional topic context sent to the ranking service. */
  topic?: string;
  /** Optional skill context sent to the ranking service. */
  skill?: string;
  /** Optional learning level. */
  level?: "beginner" | "intermediate" | "advanced";
  /** Optional BCP-47 language hint. */
  language?: string;
  /** Optional duration filter. */
  duration?: "any" | "short" | "medium" | "long";
  /** Result cap (1-12). */
  limit?: number;
}

type LoadState = "loading" | "ready" | "error";

interface FetchOutcome {
  state: LoadState;
  results: LearningResourceResult[];
  message: string | null;
}

export function LearningResources({ query, topic, skill, level, language, duration, limit }: LearningResourcesProps) {
  const [outcome, setOutcome] = useState<FetchOutcome>({ state: "loading", results: [], message: null });
  const [activeVideo, setActiveVideo] = useState<LearningResourceResult | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Runs on mount, when props change, or when the user retries. State is
  // only updated from async continuations (never synchronously inside the
  // effect body) and in-flight requests are aborted on cleanup.
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ query });
    if (topic) params.set("topic", topic);
    if (skill) params.set("skill", skill);
    if (level) params.set("level", level);
    if (language) params.set("language", language);
    if (duration) params.set("duration", duration);
    if (limit) params.set("limit", String(limit));

    fetch(`/api/learning/youtube/search?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;

        if (!response.ok) {
          const message =
            body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
              ? (body as { error: string }).error
              : "Something went wrong while searching YouTube. Please try again.";
          setOutcome({ state: "error", results: [], message });
          return;
        }

        setOutcome({ state: "ready", results: extractResults(body), message: null });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setOutcome({
          state: "error",
          results: [],
          message: "Could not reach the learning search right now. Check your connection and try again.",
        });
      });

    return () => controller.abort();
  }, [query, topic, skill, level, language, duration, limit, retryCount]);

  return (
    <section className="section" aria-labelledby="learning-resources-title">
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Youtube size={16} aria-hidden="true" />
        <h2 id="learning-resources-title" style={{ fontSize: 15, fontWeight: 800 }}>
          Learn it on YouTube
        </h2>
      </header>

      {outcome.state === "loading" ? (
        <p className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <Sparkles size={14} aria-hidden="true" /> Searching YouTube for &ldquo;{query}&rdquo;&hellip;
        </p>
      ) : null}

      {outcome.state === "error" && outcome.message ? (
        <div className="card pad" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertTriangle size={15} aria-hidden="true" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ display: "grid", gap: 8 }}>
            <p className="muted" style={{ fontSize: 13 }}>{outcome.message}</p>
            <button type="button" className="btn btn-ghost" onClick={() => {
              setOutcome({ state: "loading", results: [], message: null });
              setActiveVideo(null);
              setRetryCount((count) => count + 1);
            }}>
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {outcome.state === "ready" && outcome.results.length === 0 ? (
        <div className="card pad" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <SearchX size={15} aria-hidden="true" style={{ marginTop: 2, flexShrink: 0 }} />
          <p className="muted" style={{ fontSize: 13 }}>
            No YouTube lessons found for &ldquo;{query}&rdquo;. Try a different topic or check back later.
          </p>
        </div>
      ) : null}

      {activeVideo ? (
        <YouTubeEmbed
          videoId={activeVideo.externalId}
          title={activeVideo.title}
          onDismiss={() => setActiveVideo(null)}
        />
      ) : null}

      {outcome.state === "ready" && outcome.results.length > 0 ? (
        <div style={{ display: "grid", gap: 10 }}>
          {outcome.results.map((result) => (
            <article
              key={result.externalId}
              className="card pad"
              style={{ display: "grid", gap: 8 }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 800 }}>{result.title}</h3>
                <span className="tag mono" title="Educational relevance score (heuristic)">
                  {Math.round(result.relevanceScore)}
                </span>
              </div>
              <p className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span>{result.channelName}</span>
                {result.durationSeconds ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Clock size={12} aria-hidden="true" /> {formatDuration(result.durationSeconds)}
                  </span>
                ) : null}
              </p>
              {result.description ? (
                <p className="muted" style={{ fontSize: 13, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {result.description}
                </p>
              ) : null}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn" onClick={() => setActiveVideo(result)}>
                  <Play size={14} /> Watch here
                </button>
                <a
                  className="btn btn-ghost"
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Lightbulb size={14} /> Open on YouTube
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function extractResults(body: unknown): LearningResourceResult[] {
  if (!body || typeof body !== "object" || !("results" in body)) return [];
  const results = (body as { results: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.filter(
    (item): item is LearningResourceResult =>
      Boolean(item) &&
      typeof item === "object" &&
      "externalId" in item &&
      typeof (item as { externalId: unknown }).externalId === "string",
  );
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
