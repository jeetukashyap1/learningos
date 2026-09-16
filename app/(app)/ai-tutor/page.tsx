import { BrainCircuit } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/auth";
import { isLearningPathError } from "@/lib/learning-path/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadTutorContext, NO_PATH_CONTEXT, type TutorContext } from "@/lib/ai-tutor/context";
import { listConversations, type TutorConversationSummary } from "@/lib/ai-tutor/service";
import { AiTutorChat } from "./ai-tutor-chat";

/**
 * AI Tutor (spec §12). This is a server component so the trusted context and
 * the caller's recent conversations are derived from the signed-in user's OWN
 * database state before any UI ships to the browser - the client never supplies
 * a path/user id (spec §1/§2/§20).
 *
 * `/ai-tutor` is a protected route (lib/supabase/middleware.ts), so an
 * unauthenticated visitor is redirected to /login before this renders; the
 * anonymous branch below is only ever reached in explicit demo mode.
 */
export default async function AiTutorPage({
  searchParams,
}: {
  searchParams?: Promise<{ lesson?: string | string[] }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="container">
        <PageHeader
          eyebrow="Contextual learning support"
          title="Meet your AI Tutor."
          description="Ask for a simpler explanation, a useful hint, or a challenge that meets you where you are."
        />
        <EmptyState
          icon={BrainCircuit}
          eyebrow="SIGN IN TO START"
          title="Your tutor needs your session."
          description="The AI Tutor answers from your own learning path. Sign in and it will know your current module and lesson without you repeating anything."
          actionLabel="Sign in"
          actionHref="/login"
        />
      </main>
    );
  }

  let context: TutorContext = NO_PATH_CONTEXT;
  let conversations: TutorConversationSummary[] = [];
  let loadError: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    // A lesson named in the URL (the lesson page's "Ask AI Tutor" entry) is
    // re-verified against this user's OWN active path inside loadTutorContext -
    // a foreign or unknown id yields lesson: null instead of leaking anything
    // (spec §11). Ownership is never trusted from the query string.
    const params = (await searchParams) ?? {};
    const requestedLessonId = typeof params.lesson === "string" ? params.lesson : null;
    context = await loadTutorContext(supabase, user.id, requestedLessonId);
    if (context.hasPath) {
      conversations = await listConversations(supabase, user.id);
    }
  } catch (error) {
    // A genuine database failure degrades to an honest retry surface instead
    // of inventing context (spec §21). The detail stays server-side.
    loadError = isLearningPathError(error)
      ? error.safeMessage
      : "We could not load your AI Tutor right now.";
    console.error("[ai-tutor] page context load failed:", error);
  }

  return (
    <main className="container">
      <PageHeader
        eyebrow="Contextual learning support"
        title="Meet your AI Tutor."
        description="Your tutor already knows your current path, module, and lesson. Ask it to explain, hint, or quiz you - no context to paste."
      />

      {loadError ? (
        <EmptyState
          icon={BrainCircuit}
          eyebrow="TUTOR UNAVAILABLE"
          title="We could not load your tutor."
          description={loadError}
          actionLabel="Back to dashboard"
          actionHref="/dashboard"
        />
      ) : !context.hasPath ? (
        <EmptyState
          icon={BrainCircuit}
          eyebrow="YOUR TUTOR NEEDS CONTEXT"
          title="No path, no context yet."
          description="The tutor answers best when it knows your goal and current concepts. Create a learning path to give it that context."
          actionLabel="Create your learning path"
          actionHref="/onboarding"
        />
      ) : (
        <AiTutorChat initialContext={context} initialConversations={conversations} studentName={user.fullName} />
      )}
    </main>
  );
}
