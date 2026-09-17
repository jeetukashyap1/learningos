import { cookies } from "next/headers";
import { createSupabaseServerClient } from "./supabase/server";
import { hasUnreadNotifications } from "./notifications/service";
import {
  DEMO_COOKIE,
  DEMO_USER_STATE,
  EMPTY_USER_STATE,
  type AuthenticatedUser,
  type UserStateFlags,
} from "./user-state";

async function demoCookieOn(): Promise<boolean> {
  const store = await cookies();
  return store.get(DEMO_COOKIE)?.value === "on";
}

/**
 * Resolves the signed-in user from the Supabase session. Returns null for
 * anonymous visitors. The result is a clean AuthenticatedUser so UI code
 * never depends on the auth provider's types.
 *
 * A missing profile row (for example a user created before the migration
 * ran) degrades gracefully: account metadata is used as a fallback and
 * onboarding is simply reported as incomplete.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const authUser = data.user;

  const [profileResult, onboardingResult] = await Promise.all([
    supabase.from("profiles").select("full_name, avatar_url, created_at").eq("id", authUser.id).maybeSingle(),
    supabase.from("onboarding_profiles").select("user_id, topic").eq("user_id", authUser.id).maybeSingle(),
  ]);

  const profile = profileResult.data;
  const metadataName =
    typeof authUser.user_metadata?.full_name === "string"
      ? authUser.user_metadata.full_name.trim()
      : null;

  return {
    id: authUser.id,
    email: authUser.email ?? "",
    fullName: profile?.full_name?.trim() || metadataName || null,
    avatarUrl: profile?.avatar_url ?? null,
    createdAt: profile?.created_at ?? authUser.created_at ?? null,
    emailConfirmed: Boolean(authUser.email_confirmed_at ?? authUser.confirmed_at ?? null),
    onboardingComplete: onboardingResult.data != null,
    onboardingTopic: onboardingResult.data?.topic ?? null,
  };
}

/**
 * Derives honest UI flags for the current visitor:
 *   1. Signed-in user — flags reflect real database rows.
 *   2. Anonymous visitor in demo mode — full sample-data flags.
 *   3. Everyone else — the empty starting state.
 *
 * Demo mode never overrides a real authenticated user. Pass an already
 * resolved user to avoid a duplicate session lookup.
 */
export async function getCurrentUserState(user?: AuthenticatedUser | null): Promise<UserStateFlags> {
  const current = user === undefined ? await getCurrentUser() : user;
  if (current) {
    return learningStateFor(current.id);
  }
  return (await demoCookieOn()) ? DEMO_USER_STATE : EMPTY_USER_STATE;
}

/**
 * Real-user flags straight from the learning path tables (spec parts
 * 12-14, 16). RLS scopes every query to the caller. A learner may own
 * several learning paths, but exactly one is active at a time
 * (is_active = true, one active path per user), and every page
 * operates against that active path:
 *
 * - hasLearningPath: an active persisted path exists. Onboarding answers alone
 *   are not a path - generation must have actually finished.
 * - hasLearningHistory: the path has lessons to open and learn from.
 * - hasProgress: at least one lesson carries completed_at, the single
 *   progress signal. There is no second progress system.
 * - hasProjects: no real projects exist yet; never faked for real users.
 * - hasUnreadNotifications: at least one derived notification signal has no
 *   row in notification_reads. This is the ONLY input to the sidebar dot.
 *
 * On a database error the flags degrade to the honest no-path view so
 * the shell still renders without implying content that does not exist.
 * Onboarding completion alone never implies a path: the flag is true
 * only when an active learning_paths row is actually persisted.
 */
async function learningStateFor(userId: string): Promise<UserStateFlags> {
  const noPath: UserStateFlags = {
    hasLearningPath: false,
    hasLearningHistory: false,
    hasProgress: false,
    hasProjects: false,
    hasUnreadNotifications: false,
  };
  try {
    const supabase = await createSupabaseServerClient();
    const { data: path, error: pathError } = await supabase
      .from("learning_paths")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (pathError || !path) return noPath;

    const { data: lessons, error: lessonsError } = await supabase
      .from("learning_path_lessons")
      .select("completed_at")
      .eq("path_id", path.id);
    if (lessonsError) return { ...noPath, hasLearningPath: true };

    const lessonRows = lessons ?? [];
    // Read state is a separate, optional lookup: a failure here must never
    // break the shell, and the honest fallback is "nothing marked read yet"
    // (the dot may show, but only because the database agreed there is a
    // path with signals). It is computed from the same active path.
    const unread = await hasUnreadNotifications(supabase, userId).catch(() => false);

    return {
      hasLearningPath: true,
      hasLearningHistory: lessonRows.length > 0,
      hasProgress: lessonRows.some((lesson) => lesson.completed_at != null),
      hasProjects: false,
      hasUnreadNotifications: unread,
    };
  } catch {
    return noPath;
  }
}

/**
 * Effective demo mode: sample data is shown only when no real user is
 * signed in, so a stale demo cookie never leaks into an authenticated
 * session. Pass an already resolved user to avoid a duplicate lookup.
 */
export async function isDemoMode(user?: AuthenticatedUser | null): Promise<boolean> {
  const current = user === undefined ? await getCurrentUser() : user;
  return !current && (await demoCookieOn());
}
