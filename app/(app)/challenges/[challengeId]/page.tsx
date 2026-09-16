import Link from "next/link";
import { ArrowLeft, Target } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser, getCurrentUserState } from "@/lib/auth";
import { isLearningPathError, LearningPathError } from "@/lib/learning-path/errors";
import { loadLearningPathOverview, type LearningPathOverview } from "@/lib/learning-path/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ChallengeView, type ChallengeData } from "./challenge-view";

/** Sample challenge for anonymous demo mode only (frozen sample view). */
const sampleChallenge: ChallengeData = {
  id: "rest-methods",
  title: "Choose the right REST method",
  prompt: "A user edits their profile bio. Which HTTP method best represents this action, and why that one?",
  objective: "PATCH changes part of an existing resource, such as a single profile field - the smallest useful action.",
  concepts: ["GET reads a resource", "POST creates something new", "PATCH partially updates", "DELETE removes"],
  skill: "REST API methods",
  level: "beginner",
  lessonHref: "/learn/rest-methods",
};

function backToPractice() {
  return <Link href="/practice" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}><ArrowLeft size={15} /> Back to practice</Link>;
}

/**
 * A single challenge, derived from the persisted lesson it belongs to
 * (spec part 19): the practice concept becomes the prompt and the
 * lesson objective and concepts become the reference approach. There
 * is no hardcoded answer key and no fallback to sample challenges for
 * a signed-in learner.
 */
export default async function ChallengePage({ params }: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await params;
  const user = await getCurrentUser();
  const state = await getCurrentUserState(user);

  if (!state.hasLearningPath) {
    return <main className="container">{backToPractice()}
      <div style={{ maxWidth: 720, margin: "34px auto 0" }}>
        <EmptyState icon={Target} eyebrow="CHALLENGES FOLLOW YOUR PATH" title="No challenge yet." description="Challenges are chosen from the concepts you are learning. Create your learning path to unlock your first one." actionLabel="Create your learning path" actionHref="/onboarding" />
      </div>
    </main>;
  }

  let overview: LearningPathOverview | null = null;
  let loadError: LearningPathError | null = null;
  if (user) {
    const supabase = await createSupabaseServerClient();
    try {
      overview = await loadLearningPathOverview(supabase, user.id);
    } catch (error) {
      if (isLearningPathError(error)) loadError = error;
      else loadError = new LearningPathError("unexpected", "We could not load your path right now. Please refresh the page.");
    }
  }

  if (loadError) {
    return <main className="container">{backToPractice()}
      <div style={{ maxWidth: 720, margin: "34px auto 0" }}>
        <EmptyState icon={Target} eyebrow="PATH UNAVAILABLE" title="We could not load your path." description={loadError.safeMessage} />
      </div>
    </main>;
  }

  if (user && overview) {
    // The challenge id is the lesson id on the active path; anything
    // else is honestly reported as not on this path (spec part 26).
    const lesson = overview.lessons.find((item) => item.id === challengeId) ?? null;
    if (!lesson) {
      return <main className="container">{backToPractice()}
        <div style={{ maxWidth: 720, margin: "34px auto 0" }}>
          <EmptyState icon={Target} eyebrow="CHALLENGE NOT FOUND" title="This challenge is not on your path." description="It may belong to a different learning path. Pick a challenge from your practice page instead." actionLabel="Back to practice" actionHref="/practice" />
        </div>
      </main>;
    }
    const challenge: ChallengeData = {
      id: lesson.id,
      title: lesson.title,
      prompt: lesson.practice_concept || lesson.objective,
      objective: lesson.objective,
      concepts: lesson.concepts,
      skill: lesson.skill.trim() || lesson.topic,
      level: lesson.level,
      lessonHref: `/learn/${lesson.id}`,
    };
    return <main className="container">{backToPractice()}<ChallengeView challenge={challenge} /></main>;
  }

  // Defense in depth: a signed-in learner whose path will not load must
  // never fall through to the sample challenge.
  if (user) {
    return <main className="container">{backToPractice()}
      <div style={{ maxWidth: 720, margin: "34px auto 0" }}>
        <EmptyState icon={Target} eyebrow="CHALLENGES FOLLOW YOUR PATH" title="No challenge yet." description="Challenges are chosen from the concepts you are learning. Create your learning path to unlock your first one." actionLabel="Create your learning path" actionHref="/onboarding" />
      </div>
    </main>;
  }

  // Anonymous demo mode: the original sample challenge (frozen view).
  return <main className="container">{backToPractice()}<ChallengeView challenge={sampleChallenge} /></main>;
}
