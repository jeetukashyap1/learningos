/**
 * Error model for the AI (NVIDIA NIM) layer.
 *
 * Mirrors lib/youtube/errors.ts: every failure surfaces as an AiError with:
 * - `kind`: how the API route should map it (502 / 503)
 * - `safeMessage`: safe to return to the browser - no key material, raw
 *   upstream URLs, model internals, or stack traces ever leak into it
 * - `message` (inherited): server-side detail for logging only
 *
 * Kinds and their HTTP mapping in the generate route:
 * - config        -> 503 (key missing/invalid on this server)
 * - rate_limit    -> 503 (upstream busy; retry later)
 * - timeout       -> 502 (generation took too long)
 * - network       -> 502 (could not reach the provider)
 * - api           -> 502 (provider returned an unexpected response)
 * - invalid_output-> 502 (curriculum JSON failed validation after retries)
 */

export type AiErrorKind =
  | "config"
  | "rate_limit"
  | "timeout"
  | "network"
  | "api"
  | "invalid_output";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly safeMessage: string;

  constructor(kind: AiErrorKind, safeMessage: string, detail?: string) {
    super(detail ?? safeMessage);
    this.name = "AiError";
    this.kind = kind;
    this.safeMessage = safeMessage;
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}
