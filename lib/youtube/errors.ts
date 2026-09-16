/**
 * Error model for the YouTube layer.
 *
 * Every failure surfaces as a YoutubeError with:
 * - `kind`: how the API route should map it (400 / 502 / 503 / 500)
 * - `safeMessage`: safe to return to the browser - no key material, raw
 *   upstream URLs, or internal details ever leak into it
 * - `message` (inherited): server-side detail for logging only
 */

export type YoutubeErrorKind = "config" | "quota" | "validation" | "api";

export class YoutubeError extends Error {
  readonly kind: YoutubeErrorKind;
  readonly safeMessage: string;

  constructor(kind: YoutubeErrorKind, safeMessage: string, detail?: string) {
    super(detail ?? safeMessage);
    this.name = "YoutubeError";
    this.kind = kind;
    this.safeMessage = safeMessage;
  }
}

export function isYoutubeError(error: unknown): error is YoutubeError {
  return error instanceof YoutubeError;
}
