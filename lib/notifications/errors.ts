/**
 * Error model for the notification read-state service.
 *
 * Mirrors lib/learning-path/errors.ts, lib/youtube/errors.ts and
 * lib/ai/errors.ts: every failure carries
 * - `kind`: how the API route maps it to an HTTP status
 * - `safeMessage`: safe to return to the browser - never database internals
 *   or stack traces
 * - `message` (inherited): server-side detail for logging only
 *
 * Kinds and their HTTP mapping in the notification routes:
 * - invalid     -> 400 (the caller sent a signal key we cannot accept)
 * - persistence -> 500 (the database read/write failed)
 */

export type NotificationErrorKind = "invalid" | "persistence";

export class NotificationError extends Error {
  readonly kind: NotificationErrorKind;
  readonly safeMessage: string;

  constructor(kind: NotificationErrorKind, safeMessage: string, detail?: string) {
    super(detail ?? safeMessage);
    this.name = "NotificationError";
    this.kind = kind;
    this.safeMessage = safeMessage;
  }
}

export function isNotificationError(error: unknown): error is NotificationError {
  return error instanceof NotificationError;
}
