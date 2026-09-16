import Link from "next/link";
import { ArrowRight, Brain, CheckCircle2, Flame, Gauge, RotateCcw, Target } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { NoLearningPath } from "@/components/no-learning-path";
import { getCurrentUser, getCurrentUserState } from "@/lib/auth";
import { isLearningPathError, LearningPathError } from "@/lib/learning-path/errors";
import { loadLearningPathOverview, type LearningPathOverview } from "@/lib/learning-path/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Sample challenge for anonymous demo mode only (frozen sample view). */
const sampleChallenge = {
  id: "rest-methods",
  title: "Choose the right REST method",
  prompt: "A user edits their profile bio. Which method best represents this action?",
  level: "beginner",
  skill: "REST API methods",
};

/**
 * Practice, derived from the persisted curriculum: every challenge is
 * the practice concept of a real incomplete lesson on the active path,
 * shown with the module it belongs to, and the stats count real lessons
 * only. Domain-aware by construction - a physics path offers physics
 * practice, never REST.
 */
export default async function PracticePage() {
  const user = await getCurrentUser();
  const state = await getCurrentUserState(user);

  if (!state.hasLearningPath) {
    return <main className="container">
      <PageHeader eyebrow="Retrieval · Feedback · Mastery" title="Practice with purpose." description="Short challenges reveal what you can do without hints, then point you toward the most useful next review." />
      <NoLearningPath icon={Target} eyebrow="PRACTICE FOLLOWS YOUR PATH" title="No challenges yet." description="Challenges are chosen from the skills on your path. Create a learning path and practice becomes specific to you." />
    </main>;
  }

  // Signed-in path holders get real challenges; anonymous demo visitors
  // (state.hasLearningPath via the demo cookie) see the sample view.
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
    return <main className="container">
      <PageHeader eyebrow="Retrieval · Feedback · Mastery" title="Practice with purpose." description="Short challenges reveal what you can do without hints, then point you toward the most useful next review." />
      <EmptyState icon={Target} eyebrow="PATH UNAVAILABLE" title="We could not load your path." description={loadError.safeMessage} />
    </main>;
  }

  if (user && overview) {
    return <RealPractice overview={overview} />;
  }

  // Defense in depth: a signed-in learner whose path will not load must
  // never fall through to the sample challenge.
  if (user) {
    return <main className="container">
      <PageHeader eyebrow="Retrieval · Feedback · Mastery" title="Practice with purpose." description="Short challenges reveal what you can do without hints, then point you toward the most useful next review." />
      <NoLearningPath icon={Target} eyebrow="PRACTICE FOLLOWS YOUR PATH" title="No challenges yet." description="Challenges are chosen from the skills on your path. Create a learning path and practice becomes specific to you." />
    </main>;
  }

  // Anonymous demo mode: the original sample practice view.
  return <DemoPractice />;
}

/** The real practice page: challenges from lesson practice concepts, each labeled with its module. */
function RealPractice({ overview }: { overview: LearningPathOverview }) {
  const { lessons, modules, completedLessonCount } = overview;
  const total = lessons.length;
  const incomplete = lessons.filter((lesson) => lesson.completed_at == null);
  const percent = total > 0 ? Math.round((completedLessonCount / total) * 100) : 0;
  const firstChallenge = incomplete[0] ?? lessons[0] ?? null;
  const moduleById = new Map(modules.map((module) => [module.id, module]));

  // Each incomplete lesson contributes its practice concept as a
  // challenge, linked to its own lesson page and labeled with the
  // module it belongs to.
  const challenges = incomplete.slice(0, 4).map((lesson) => {
    const lessonModule = lesson.module_id ? moduleById.get(lesson.module_id) ?? null : null;
    return {
      id: lesson.id,
      title: lesson.title,
      prompt: lesson.practice_concept || lesson.objective,
      level: lesson.level,
      skill: lesson.skill.trim() || lesson.topic,
      moduleLabel: lessonModule ? `Module ${lessonModule.orderIndex} · ${lessonModule.title}` : null,
    };
  });

  return <main className="container">
    <PageHeader
      eyebrow="Retrieval · Feedback · Mastery"
      title="Practice with purpose."
      description="Short challenges reveal what you can do without hints, then point you toward the most useful next review."
      action={firstChallenge ? <Link href={`/challenges/${firstChallenge.id}`} className="btn btn-primary"><Target size={15} />Start a challenge</Link> : undefined}
    />
    <div className="grid grid-3" style={{ marginTop: 28 }}>
      {[
        { label: "Ready to practice", value: String(incomplete.length), icon: Target, color: "var(--mint)" },
        { label: "Completed lessons", value: String(completedLessonCount), icon: RotateCcw, color: "var(--peach)" },
        { label: "Path progress", value: `${percent}%`, icon: Gauge, color: "var(--lime)" },
      ].map(({ label, value, icon: Icon, color }) => (
        <div className={color === "var(--lime)" ? "card pad lime-surface" : "card pad"} key={label} style={{ background: color }}>
          <Icon size={19} />
          <div className="mono muted" style={{ fontSize: 10, marginTop: 24 }}>{label.toUpperCase()}</div>
          <strong style={{ fontSize: 28, display: "block", marginTop: 7 }}>{value}</strong>
        </div>
      ))}
    </div>

    {total === 0 ? <section className="section"><div className="card pad">
      <div className="eyebrow">RECOMMENDED NOW</div>
      <p className="muted" style={{ marginTop: 10 }}>Your lessons are still being prepared. Refresh in a moment and your first challenges appear.</p>
    </div></section> : challenges.length > 0 ? <section className="section">
      <div className="section-head"><div><div className="eyebrow">RECOMMENDED NOW</div><h2 style={{ marginTop: 7 }}>Build confidence, one decision at a time.</h2></div></div>
      <div className="grid grid-2">
        {challenges.map((challenge) => (
          <article className="card pad" key={challenge.id}>
            <div className="move">
              <div className="move-icon"><Brain size={22} /></div>
              <div><span className="tag">{challenge.level}</span><h3 style={{ marginTop: 9 }}>{challenge.title}</h3>{challenge.moduleLabel && <small className="muted" style={{ display: "block", marginTop: 5, fontSize: 11 }}>{challenge.moduleLabel}</small>}</div>
            </div>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 20 }}>{challenge.prompt}</p>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22 }}>
              <span className="mono muted" style={{ fontSize: 10 }}>{challenge.skill}</span>
              <Link href={`/challenges/${challenge.id}`} className="btn btn-dark">Practice <ArrowRight size={14} /></Link>
            </div>
          </article>
        ))}
      </div>
    </section> : <section className="section"><div className="card pad">
      <div className="eyebrow">RECOMMENDED NOW</div>
      <p className="muted" style={{ marginTop: 10 }}>You have completed every lesson on this path. Create a new path to unlock fresh challenges.</p>
    </div></section>}

    <div className="card pad section" style={{ display: "flex", gap: 15, alignItems: "center" }}>
      <CheckCircle2 size={20} color="#5d963f" />
      <p style={{ fontSize: 13 }}><strong>Practice is not a test.</strong> It is a fast way to make your next learning session more specific.</p>
    </div>
  </main>;
}

/** Anonymous demo mode only: the frozen sample practice view. */
function DemoPractice() {
  return <main className="container">
    <PageHeader eyebrow="Retrieval · Feedback · Mastery" title="Practice with purpose." description="Short challenges reveal what you can do without hints, then point you toward the most useful next review." action={<Link href={`/challenges/${sampleChallenge.id}`} className="btn btn-primary"><Target size={15} />Start a challenge</Link>} />
    <div className="grid grid-3" style={{ marginTop: 28 }}>
      {[{ label: "Ready to practice", value: "8", icon: Target, color: "var(--mint)" }, { label: "Due for review", value: "3", icon: RotateCcw, color: "var(--peach)" }, { label: "Meaningful streak", value: "4 days", icon: Flame, color: "var(--lime)" }].map(({ label, value, icon: Icon, color }) => (
        <div className={color === "var(--lime)" ? "card pad lime-surface" : "card pad"} key={label} style={{ background: color }}><Icon size={19} /><div className="mono muted" style={{ fontSize: 10, marginTop: 24 }}>{label.toUpperCase()}</div><strong style={{ fontSize: 28, display: "block", marginTop: 7 }}>{value}</strong></div>
      ))}
    </div>
    <section className="section"><div className="section-head"><div><div className="eyebrow">RECOMMENDED NOW</div><h2 style={{ marginTop: 7 }}>Build confidence, one decision at a time.</h2></div></div><div className="grid grid-2">
      <article className="card pad"><div className="move"><div className="move-icon"><Brain size={22} /></div><div><span className="tag">Scenario</span><h3 style={{ marginTop: 9 }}>{sampleChallenge.title}</h3></div></div><p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 20 }}>{sampleChallenge.prompt}</p><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 22 }}><span className="mono muted" style={{ fontSize: 10 }}>{sampleChallenge.skill}</span><Link href={`/challenges/${sampleChallenge.id}`} className="btn btn-dark">Practice <ArrowRight size={14} /></Link></div></article>
    </div></section>
    <div className="card pad section" style={{ display: "flex", gap: 15, alignItems: "center" }}><CheckCircle2 size={20} color="#5d963f" /><p style={{ fontSize: 13 }}><strong>Practice is not a test.</strong> It is a fast way to make your next learning session more specific.</p></div>
  </main>;
}
