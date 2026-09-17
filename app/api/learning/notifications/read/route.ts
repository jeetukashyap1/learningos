/**
 * POST /api/learning/notifications/read
 *
 * Marks ONE derived notification signal read for the signed-in learner, so
 * "unread" survives the next render as "read". Body: { "key": string } —
 * the stable signal key produced by lib/notifications/service.ts.
 *
 * This route owns the READ STATE only. Notification content is never stored
 * or sent from here: signals are derived from the learner's own active path
 * (spec: no second content system, no demo data). Ownership is enforced by
 * RLS (user_id = auth.uid()) and the service passes the authenticated user
 * id explicitly (defense in depth).
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isNotificationError, type NotificationErrorKind } from "@/lib/notifications/errors";
import { markNotificationRead, MAX_SIGNAL_KEY_LENGTH } from "@/lib/notifications/service";

export async function POST(request: NextRequest) {
  // 1. Authenticate (middleware only refreshes sessions on /api/*).
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json(
      { error: "Please sign in to update your notifications." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  // 2. Validate the required body: { key: string }.
  const rawBody = await request.text();
  if (rawBody.trim() === "") {
    return badRequest("Invalid request body: expected a JSON object.");
  }
  let key: string;
  try {
    const body: unknown = JSON.parse(rawBody);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return badRequest("Invalid request body: expected a JSON object.");
    }
    const { key: requested } = body as { key?: unknown };
    if (typeof requested !== "string") {
      return badRequest('Invalid request body: "key" must be a string.');
    }
    const trimmed = requested.trim();
    if (trimmed === "" || trimmed.length > MAX_SIGNAL_KEY_LENGTH) {
      return badRequest('Invalid request body: "key" is not a valid notification key.');
    }
    key = trimmed;
  } catch {
    return badRequest("Invalid request body: expected JSON.");
  }

  // 3. Persist the read state on the caller's own row (idempotent).
  try {
    await markNotificationRead(supabase, data.user.id, key);
    return NextResponse.json(
      { key, read: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isNotificationError(error)) {
      console.error(`[notifications] read update failed (${error.kind}):`, error.message);
      const statusByKind: Record<NotificationErrorKind, number> = {
        invalid: 400,
        persistence: 500,
      };
      return NextResponse.json(
        { error: error.safeMessage },
        { status: statusByKind[error.kind], headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[notifications] Unexpected read update failure:", error);
    return NextResponse.json(
      { error: "Something went wrong while saving your notification state. Please try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function badRequest(message: string): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
