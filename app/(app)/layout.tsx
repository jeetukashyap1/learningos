import { AppShell } from "@/components/app-shell";
import { DemoBanner } from "@/components/demo-banner";
import { UserStateProvider } from "@/components/user-state-provider";
import { getCurrentUser, getCurrentUserState, isDemoMode } from "@/lib/auth";
import { loadSearchItems } from "@/lib/learning-path/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SearchItem } from "@/lib/user-state";

export default async function StudentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Resolve the session once; flags and demo status reuse the result so the
  // layout never performs duplicate Supabase lookups.
  const user = await getCurrentUser();
  const [state, demo] = await Promise.all([getCurrentUserState(user), isDemoMode(user)]);

  // Real search entries for signed-in path holders (spec part 35): their
  // own lessons and path, loaded from persisted rows. Search is an
  // enhancement, so a failed read degrades to page-only results instead
  // of breaking the layout - pages surface path errors honestly.
  let searchItems: SearchItem[] = [];
  if (user && state.hasLearningPath) {
    const supabase = await createSupabaseServerClient();
    try {
      searchItems = await loadSearchItems(supabase, user.id);
    } catch {
      // Deliberately swallowed: the shell just searches pages.
    }
  }

  return (
    <UserStateProvider state={state} user={user} searchItems={searchItems}>
      <AppShell banner={demo ? <DemoBanner /> : null}>{children}</AppShell>
    </UserStateProvider>
  );
}
