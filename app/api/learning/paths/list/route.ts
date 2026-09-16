/**
 * GET /api/learning/paths/list
 *
 * Returns the signed-in user's learning-path library (spec part 16): every
 * persisted path with its subject, domain, active flag, and lesson progress.
 * Used by the "My Learning Paths" switcher.
 *
 * Middleware refreshes sessions on /api/* but does not protect them, so this
 * route authenticates itself via createSupabaseServerClient().auth.getUser().
 * RLS additionally scopes every row to the requesting user server-side.
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listLearningPaths } from "@/lib/learning-path/service";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) {
    return NextResponse.json(
      { error: "Please sign in to view your learning paths." },
      { status: 401 },
    );
  }

  try {
    const paths = await listLearningPaths(supabase, data.user.id);
    return NextResponse.json(
      { paths },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[learning-paths] list failed:", error);
    return NextResponse.json(
      { error: "Something went wrong while loading your learning paths. Please try again." },
      { status: 500 },
    );
  }
}
