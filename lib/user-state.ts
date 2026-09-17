/**
 * LearningOS user state.
 *
 * Phase 2.1: flags are derived on the server from real data (lib/auth.ts).
 * A signed-in user gets honest flags backed by database rows; a visitor who
 * explicitly opted into demo mode gets the full sample-data flags; everyone
 * else starts empty. UI code consumes flags via UserStateProvider and never
 * imports mock data or Supabase clients directly.
 */

export interface UserStateFlags {
  hasLearningPath: boolean;
  hasLearningHistory: boolean;
  hasProgress: boolean;
  hasProjects: boolean;
  /**
   * At least one derived notification signal on the active path has not been
   * read yet (no row in notification_reads). This is the ONLY thing the
   * sidebar notification dot is keyed to - learning history alone must never
   * light it up.
   */
  hasUnreadNotifications: boolean;
}

/**
 * Clean shape for the signed-in user, decoupled from the auth provider's
 * user object. UI code depends on this interface only.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
  emailConfirmed: boolean;
  onboardingComplete: boolean;
  onboardingTopic: string | null;
}

/**
 * One entry the global search can match and navigate to. Real entries are
 * derived on the server from persisted learning-path rows; the frozen
 * sample set exists only inside anonymous demo mode.
 */
export interface SearchItem {
  title: string;
  kind: string;
  href: string;
  hint?: string;
}

/** Default state for every new visitor: nothing fake, nothing assumed. */
export const EMPTY_USER_STATE: UserStateFlags = {
  hasLearningPath: false,
  hasLearningHistory: false,
  hasProgress: false,
  hasProjects: false,
  hasUnreadNotifications: false,
};

/** State used only inside explicitly-enabled demo mode. */
export const DEMO_USER_STATE: UserStateFlags = {
  hasLearningPath: true,
  hasLearningHistory: true,
  hasProgress: true,
  hasProjects: true,
  // Demo mode deliberately previews the finished space, dot included.
  hasUnreadNotifications: true,
};

export const DEMO_COOKIE = "learningos-demo";

/** Client-side demo cookie helpers. Only call from event handlers. */
export function setDemoMode(enabled: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = enabled
    ? `${DEMO_COOKIE}=on; path=/; max-age=604800; samesite=lax`
    : `${DEMO_COOKIE}=; path=/; max-age=0`;
}
