/**
 * AI Tutor 2.0 - shared HTTP plumbing for the /api/ai-tutor routes
 * (spec §20, §21).
 *
 * Every AI Tutor route authenticates the same way, maps the same two error
 * families to status codes, and must never be cached. Keeping that logic in
 * one place means the four routes cannot drift apart - and, importantly,
 * means the error mapping is consistent so a provider outage (AiError) and a
 * persistence failure (LearningPathError) always surface with the same safe
 * status and the same secret-free message.
 *
 * Nothing here ever puts a raw upstream message, a provider URL, a key, or a
 * stack trace in the response body - only `safeMessage` travels to the
 * browser (spec §21).
 */

import { NextResponse } from "next/server";
import { isAiError, type AiErrorKind } from "@/lib/ai/errors";
import { isLearningPathError, type LearningPathErrorKind } from "@/lib/learning-path/errors";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** UUID shape, so a malformed id is a clean 400/404 rather than a DB error. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 401 for an absent session. Middleware refreshes /api/* but does not gate it. */
export function unauthorized(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 401, headers: NO_STORE });
}

/** 400 for a malformed request body. */
export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE });
}

/** A successful JSON response that must never be cached. */
export function jsonOk(body: unknown): NextResponse {
  return NextResponse.json(body, { headers: NO_STORE });
}

/** Provider failures: config/rate_limit -> 503, everything else -> 502. */
function aiStatusByKind(kind: AiErrorKind): number {
  const statusByKind: Record<AiErrorKind, number> = {
    config: 503,
    rate_limit: 503,
    timeout: 502,
    network: 502,
    api: 502,
    invalid_output: 502,
  };
  return statusByKind[kind];
}

/** Domain failures: onboarding_missing -> 409, not_found -> 404, else 500. */
function pathStatusByKind(kind: LearningPathErrorKind): number {
  const statusByKind: Record<LearningPathErrorKind, number> = {
    onboarding_missing: 409,
    not_found: 404,
    persistence: 500,
    unexpected: 500,
  };
  return statusByKind[kind];
}

/**
 * Maps any thrown error to a safe JSON response, logging the real detail
 * server-side. `label` names the operation in the log line only.
 */
export function errorResponse(error: unknown, label: string): NextResponse {
  if (isAiError(error)) {
    console.error(`[ai-tutor] ${label} provider failure (${error.kind}):`, error.message);
    return NextResponse.json(
      { error: error.safeMessage },
      { status: aiStatusByKind(error.kind), headers: NO_STORE },
    );
  }

  if (isLearningPathError(error)) {
    console.error(`[ai-tutor] ${label} failed (${error.kind}):`, error.message);
    return NextResponse.json(
      { error: error.safeMessage },
      { status: pathStatusByKind(error.kind), headers: NO_STORE },
    );
  }

  console.error(`[ai-tutor] ${label} unexpected failure:`, error);
  return NextResponse.json(
    { error: "Something went wrong with your AI Tutor. Please try again." },
    { status: 500, headers: NO_STORE },
  );
}
