/**
 * POST /api/learning/paths/active
 *
 * Switches the user's active learning path (spec part 16). Body:
 *   { "pathId": "<uuid>" }
 *
 * The service layer deactivates the current active path and activates the
 * requested one in a user-scoped way (RLS additionally enforces ownership
 * server-side). Switching never mutates lessons or resources of either path.
 *
 * Middleware refreshes sessions on /api/* but does not protect them, so this
 * route authenticates itself via createSupabaseServerClient().auth.getUser().
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setActiveLearningPath } from "@/lib/learning-path/service";
import { isLearningPathError, type LearningPathErrorKind } from "@/lib/learning-path/errors";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json(
      { error: "Please sign in to switch your learning path." },
      { status: 401 },
    );
  }

  let pathId: unknown;
  try {
    const body = await request.json();
    pathId = (body as { pathId?: unknown })?.pathId;
  } catch {
    pathId = null;
  }
  if (typeof pathId !== "string" || pathId.trim().length === 0) {
    return NextResponse.json(
      { error: "A pathId is required to switch learning paths." },
      { status: 400 },
    );
  }

  try {
    await setActiveLearningPath(supabase, data.user.id, pathId.trim());
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isLearningPathError(error)) {
      console.error(`[learning-paths] switch failed (${error.kind}):`, error.message);
      return NextResponse.json(
        { error: error.safeMessage },
        { status: pathStatusByKind(error.kind), headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("[learning-paths] Unexpected switch failure:", error);
    return NextResponse.json(
      { error: "Something went wrong while switching your learning path. Please try again." },
      { status: 500 },
    );
  }
}

function pathStatusByKind(kind: LearningPathErrorKind): number {
  switch (kind) {
    case "not_found":
      return 404;
    case "onboarding_missing":
      return 409;
    default:
      return 500;
  }
}
