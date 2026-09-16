/**
 * Error model for the learning-path service.
 *
 * Mirrors lib/youtube/errors.ts and lib/ai/errors.ts: every failure carries
 * - `kind`: how the API routes map it to an HTTP status
 * - `safeMessage`: safe to return to the browser - never keys, upstream
 *   URLs, model internals, or stack traces
 * - `message` (inherited): server-side detail for logging only
 *
 * Kinds and their HTTP mapping in the learning-path routes:
 * - onboarding_missing -> 409 (complete onboarding first)
 * - not_found          -> 404 (e.g. retry requested with no path yet)
 * - persistence        -> 500 (database read/write failed)
 * - unexpected         -> 500 (guard against impossible states)
 *
 * AiError and YoutubeError intentionally never pass through this class:
 * the routes map AiError directly, and the service swallows hard YoutubeError
 * failures into 'pending' lessons so the path persists regardless
 * (spec part 15).
 */

export type LearningPathErrorKind =
  | "onboarding_missing"
  | "not_found"
  | "persistence"
  | "unexpected";

export class LearningPathError extends Error {
  readonly kind: LearningPathErrorKind;
  readonly safeMessage: string;

  constructor(kind: LearningPathErrorKind, safeMessage: string, detail?: string) {
    super(detail ?? safeMessage);
    this.name = "LearningPathError";
    this.kind = kind;
    this.safeMessage = safeMessage;
  }
}

export function isLearningPathError(error: unknown): error is LearningPathError {
  return error instanceof LearningPathError;
}
