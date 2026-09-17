/**
 * YouTubeEmbed: the smallest reusable component for playing a YouTube video.
 *
 * Security rules baked in:
 * - Only a VALIDATED canonical video id is ever used. The id is re-validated
 *   here (11 chars, [A-Za-z0-9_-]) even though the API route already
 *   validated it, so this component can never be tricked into embedding an
 *   arbitrary URL.
 * - The embed source is fixed to youtube-nocookie.com; nothing user-supplied
 *   besides the video id is ever interpolated into the iframe.
 * - The parent API route only returns embeddable public videos, and the id
 *   pattern check prevents any URL/HTML injection through the id itself.
 */

"use client";

import { Play, X, Youtube as YoutubeIcon } from "lucide-react";

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export interface YouTubeEmbedProps {
  videoId: string;
  title: string;
  onDismiss?: () => void;
}

/** Returns true only for canonical 11-character YouTube video ids. */
export function isValidYoutubeVideoId(videoId: string): boolean {
  return VIDEO_ID_PATTERN.test(videoId);
}

export function YouTubeEmbed({ videoId, title, onDismiss }: YouTubeEmbedProps) {
  if (!isValidYoutubeVideoId(videoId)) return null;

  return (
    <section className="card pad" style={{ display: "grid", gap: 12 }} aria-label={`Video player: ${title}`}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <p className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <YoutubeIcon size={14} /> Now playing
        </p>
        {onDismiss ? (
          <button type="button" className="btn btn-ghost" onClick={onDismiss} aria-label="Close video player">
            <X size={15} /> Close
          </button>
        ) : null}
      </header>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: "inherit",
          overflow: "hidden",
          background: "var(--ink)",
        }}
      >
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}`}
          title={title}
          width="100%"
          height="100%"
          style={{ position: "absolute", inset: 0, border: 0 }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <p className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
        <Play size={13} /> {title}
      </p>
    </section>
  );
}
