import Link from "next/link";
import { Library } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { NoLearningPath } from "@/components/no-learning-path";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLearningPathError, LearningPathError } from "@/lib/learning-path/errors";
import { listLearningPaths, type LearningPathListItem } from "@/lib/learning-path/service";
import { PathLibrary } from "./path-library";

/**
 * "My Learning Paths" - the learner's path library (spec part 16). Every
 * card is a real persisted learning_paths row with real lesson and
 * completion counts from listLearningPaths(); there is no sample library.
 *
 * The library is inherently personal, so anonymous visitors (including
 * demo mode) get the honest empty state instead of fake paths - demo mode
 * keeps its frozen sample views elsewhere in the app.
 */
export default async function PathsPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="container">
        <PageHeader eyebrow="Your learning, one path at a time" title="My learning paths" description="Every path you build stays here — continue the one you are on, switch between them, or start something new." />
        <NoLearningPath icon={Library} eyebrow="YOUR LIBRARY STARTS WITH A PATH" title="No learning paths yet." description="Your library lists every path you build, with real progress for each. Create your first path and it lives here from day one." />
      </main>
    );
  }

  // Always list for signed-in learners: even a learner whose active path is
  // temporarily missing should still see (and switch to) their other paths.
  let paths: LearningPathListItem[] = [];
  let loadError: LearningPathError | null = null;
  const supabase = await createSupabaseServerClient();
  try {
    paths = await listLearningPaths(supabase, user.id);
  } catch (error) {
    if (isLearningPathError(error)) loadError = error;
    else loadError = new LearningPathError("unexpected", "We could not load your paths right now. Please refresh the page.");
  }

  if (loadError) {
    return (
      <main className="container">
        <PageHeader eyebrow="Your learning, one path at a time" title="My learning paths" description="Every path you build stays here." />
        <EmptyState icon={Library} eyebrow="LIBRARY UNAVAILABLE" title="We could not load your paths." description={loadError.safeMessage} />
      </main>
    );
  }

  if (paths.length === 0) {
    return (
      <main className="container">
        <PageHeader eyebrow="Your learning, one path at a time" title="My learning paths" description="Every path you build stays here — continue the one you are on, switch between them, or start something new." />
        <NoLearningPath icon={Library} eyebrow="YOUR LIBRARY STARTS WITH A PATH" title="No learning paths yet." description="Your library lists every path you build, with real progress for each. Create your first path and it lives here from day one." />
      </main>
    );
  }

  return (
    <main className="container">
      <PageHeader
        eyebrow="Your learning, one path at a time"
        title="My learning paths"
        description="Continue your current path, switch to another, or create a new one. Nothing is ever mixed between paths — each keeps its own lessons and progress."
        action={<Link href="/onboarding?new=1" className="btn btn-primary">Create a new path</Link>}
      />
      <PathLibrary paths={paths} />
    </main>
  );
}
