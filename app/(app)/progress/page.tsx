import { ArrowUpRight, Compass, Gauge, TrendingUp } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { NoLearningPath } from "@/components/no-learning-path";
import { getCurrentUser, getCurrentUserState } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLearningPathError, LearningPathError } from "@/lib/learning-path/errors";
import { loadLearningPathOverview, type LearningPathOverview } from "@/lib/learning-path/service";

/**
 * The learner's progress, from real data (spec part 14): the ONLY progress
 * signal is completed_at on learning_path_lessons, reused here through
 * loadLearningPathOverview - there is no second progress system and no
 * watch history. Overall, per-module, practice, and final-outcome status
 * all derive from those same rows. Anonymous demo mode keeps the frozen
 * sample experience.
 */

const OUTCOME_LABELS: Record<string, string> = {
  project: "Final Project",
  assessment: "Final Assessment",
  "mock-exam": "Mock Exam",
  "mock-interview": "Mock Interview",
  "case-study": "Case Study",
  presentation: "Presentation",
  portfolio: "Portfolio",
  other: "Final Outcome",
};

function outcomeLabel(kind: string): string {
  return OUTCOME_LABELS[kind] ?? "Final Outcome";
}

export default async function ProgressPage() {
  const user = await getCurrentUser();
  const state = await getCurrentUserState(user);

  if (!state.hasProgress) {
    return <NoProgressView hasPath={state.hasLearningPath} />;
  }

  // Signed-in learners get their real path; anonymous demo visitors
  // (state.hasProgress via the demo cookie) see the sample metrics.
  if (user) {
    const supabase = await createSupabaseServerClient();
    let overview: LearningPathOverview | null = null;
    let loadError: LearningPathError | null = null;
    try {
      overview = await loadLearningPathOverview(supabase, user.id);
    } catch (error) {
      if (isLearningPathError(error)) loadError = error;
      else loadError = new LearningPathError("unexpected", "We could not load your progress right now. Please refresh the page.");
    }

    if (loadError) {
      return <main className="container">
        <PageHeader eyebrow="Capability over consumption" title="See your progress clearly." description="LearningOS measures the skills you can explain, apply, and revisit — not how many hours you kept a tab open." />
        <EmptyState icon={Gauge} eyebrow="PROGRESS UNAVAILABLE" title="We could not load your progress." description={loadError.safeMessage} />
      </main>;
    }

    if (overview) {
      return <RealProgress overview={overview} />;
    }

    // Flags said progress but the path is gone - show the honest empty state.
    // The overview load is the fresher read, so the DB wins: no path.
    return <NoProgressView hasPath={false} />;
  }

  // Anonymous demo mode: the original sample metrics (frozen experience).
  return <DemoProgress />;
}

/**
 * No completions yet. A learner with a path is invited to their journey;
 * a learner without one gets the shared no-path state with its CTA.
 */
function NoProgressView({ hasPath }: { hasPath: boolean }) {
  return <main className="container">
    <PageHeader eyebrow="Capability over consumption" title="See your progress clearly." description="LearningOS measures the skills you can explain, apply, and revisit — not how many hours you kept a tab open." />
    {hasPath ? (
      <EmptyState icon={Gauge} eyebrow="NOTHING TO MEASURE YET" title="No progress to show." description="Your path is ready but no lesson is complete yet. Finish your first lesson and your progress appears here." actionLabel="Go to my journey" actionHref="/journey" />
    ) : (
      <NoLearningPath icon={Gauge} eyebrow="NOTHING TO MEASURE YET" title="No progress to show." description="Progress appears as you complete lessons, solve challenges, and build projects. It starts with your learning path." />
    )}
  </main>;
}

/** The real progress: every number derives from learning_path_lessons rows. */
function RealProgress({ overview }: { overview: LearningPathOverview }) {
  const { path, lessons, modules, finalOutcome, nextLessonId, completedLessonCount } = overview;
  const total = lessons.length;
  const percent = total > 0 ? Math.round((completedLessonCount / total) * 100) : 0;
  const remaining = Math.max(total - completedLessonCount, 0);
  const nextLesson = lessons.find((lesson) => lesson.id === nextLessonId) ?? null;
  const hasModules = modules.length > 0;
  const hasOutcome = finalOutcome.kind !== "";
  const nextModule = nextLesson && nextLesson.module_id
    ? modules.find((module) => module.id === nextLesson.module_id) ?? null
    : null;
  const videosFound = lessons.filter((lesson) => lesson.resource_status === "found").length;
  const videoPercent = total > 0 ? Math.round((videosFound / total) * 100) : 0;
  const minutesDone = lessons
    .filter((lesson) => lesson.completed_at != null)
    .reduce((sum, lesson) => sum + lesson.estimated_minutes, 0);

  // Practice progress: every lesson carries a practice concept, and
  // completing the lesson is what clears its practice - completed_at is
  // the only signal, so this is the honest derivation, not a second score.
  const practiceLessons = lessons.filter((lesson) => lesson.practice_concept.trim().length > 0);
  const practiceTotal = practiceLessons.length;
  const practiceDone = practiceLessons.filter((lesson) => lesson.completed_at != null).length;
  const practicePercent = practiceTotal > 0 ? Math.round((practiceDone / practiceTotal) * 100) : 0;

  // Skill momentum: completion per skill, in curriculum first-appearance order.
  const skillStats: { name: string; done: number; total: number }[] = [];
  for (const lesson of lessons) {
    const name = lesson.skill.trim() || "General";
    let entry = skillStats.find((item) => item.name === name);
    if (!entry) {
      entry = { name, done: 0, total: 0 };
      skillStats.push(entry);
    }
    entry.total += 1;
    if (lesson.completed_at != null) entry.done += 1;
  }

  const stageSubtitle = nextLesson
    ? nextModule
      ? `Module ${nextModule.orderIndex} · Lesson ${nextLesson.lesson_order} of ${total} · ${path.estimated_days} day estimate`
      : `Lesson ${nextLesson.lesson_order} of ${total} · ${path.estimated_days} day estimate`
    : `All ${total} lessons done · path complete`;

  return <main className="container">
    <PageHeader eyebrow="Capability over consumption" title="See your progress clearly." description="LearningOS measures the skills you can explain, apply, and revisit — not how many hours you kept a tab open." action={<Link href="/journey" className="btn btn-dark"><Compass size={14}/>View journey</Link>} />

    <div className="hero-grid" style={{ marginTop: 28 }}>
      <div className="card pad lime-surface" style={{ background: "var(--lime)" }}>
        <div className="eyebrow">CURRENT GOAL</div>
        <h2 style={{ fontSize: 31, marginTop: 16 }}>{path.title}</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>{stageSubtitle}</p>
        <div className="progress" style={{ marginTop: 30 }}><span style={{ width: `${percent}%`, background: "#10211b" }}/></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12 }}><strong>{percent}% of path complete</strong><span>{remaining} {remaining === 1 ? "lesson" : "lessons"} left</span></div>
      </div>
      <div className="card pad" style={{ background: "var(--navy)", color: "white" }}>
        <TrendingUp size={22} color="var(--lime)"/>
        <div className="eyebrow" style={{ color: "#a8b8b0", marginTop: 28 }}>LEARNING CONSISTENCY</div>
        <strong style={{ fontSize: 40, display: "block", marginTop: 8 }}>{completedLessonCount}</strong>
        <p style={{ color: "#c5d0cc", fontSize: 13, lineHeight: 1.5, marginTop: 7 }}>{completedLessonCount === 1 ? "lesson" : "lessons"} completed on this path</p>
        <div className="stat-row" style={{ marginTop: 28 }}>
          <div className="stat"><strong>{minutesDone}</strong><span style={{ color: "#a8b8b0", fontSize: 11 }}>minutes of learning</span></div>
          <div className="stat"><strong>{videosFound}</strong><span style={{ color: "#a8b8b0", fontSize: 11 }}>videos matched</span></div>
          {hasModules && <div className="stat"><strong>{modules.length}</strong><span style={{ color: "#a8b8b0", fontSize: 11 }}>modules</span></div>}
        </div>
      </div>
    </div>

    <div className="grid grid-3 section">
      <div className="card pad metric-card"><div className="eyebrow">LESSONS COMPLETED</div><strong>{completedLessonCount}</strong><p className="muted">Lessons marked complete on your route.</p></div>
      <div className="card pad metric-card"><div className="eyebrow">VIDEOS MATCHED</div><strong>{videosFound}</strong><p className="muted">Lessons with their YouTube video ready.</p></div>
      <div className="card pad metric-card"><div className="eyebrow">LESSONS REMAINING</div><strong>{remaining}</strong><p className="muted">Ordered lessons still ahead of you.</p></div>
    </div>

    {hasModules && <section className="section" aria-label="Module progress">
      <div className="section-head"><div><div className="eyebrow">MODULE PROGRESS</div><h2 style={{ marginTop: 7 }}>Stage by stage, from real completions.</h2></div></div>
      <div className="card pad">
        {modules.map((module) => {
          const moduleDone = module.lessons.filter((lesson) => lesson.completed_at != null).length;
          const moduleTotal = module.lessons.length;
          const modulePercent = moduleTotal > 0 ? Math.round((moduleDone / moduleTotal) * 100) : 0;
          return <div className="list-row" key={module.id}>
            <div style={{ minWidth: 170 }}>
              <strong style={{ fontSize: 13 }}>Module {module.orderIndex}: {module.title}</strong>
              <p className="muted" style={{ fontSize: 10, marginTop: 4 }}>{moduleDone} of {moduleTotal} lessons done</p>
            </div>
            <div style={{ width: "35%", minWidth: 100 }}><div className="progress"><span style={{ width: `${modulePercent}%` }}/></div></div>
            <span className="mono" style={{ fontSize: 11 }}>{modulePercent}%</span>
          </div>;
        })}
      </div>
    </section>}

    <section className="section">
      <div className="section-head"><div><div className="eyebrow">SKILL MOMENTUM</div><h2 style={{ marginTop: 7 }}>Where your capability is moving.</h2></div></div>
      <div className="card pad">
        {skillStats.map((stat) => {
          const skillPercent = stat.total > 0 ? Math.round((stat.done / stat.total) * 100) : 0;
          return <div className="list-row" key={stat.name}>
            <div style={{ minWidth: 150 }}>
              <strong style={{ fontSize: 13 }}>{stat.name}</strong>
              <p className="muted" style={{ fontSize: 10, marginTop: 4 }}>{stat.done} of {stat.total} lessons done</p>
            </div>
            <div style={{ width: "35%", minWidth: 100 }}><div className="progress"><span style={{ width: `${skillPercent}%` }}/></div></div>
            <span className="mono" style={{ fontSize: 11 }}>{skillPercent}%</span>
          </div>;
        })}
      </div>
    </section>

    <section className="grid grid-2 section">
      <div className="card pad">
        {nextLesson ? <>
          <div className="eyebrow">UP NEXT</div>
          <h2 style={{ marginTop: 8 }}>{nextLesson.title}</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 11 }}>{nextLesson.description}</p>
          <Link href={`/learn/${nextLesson.id}`} className="btn btn-ghost" style={{ marginTop: 18 }}>Open lesson <ArrowUpRight size={14}/></Link>
        </> : <>
          <div className="eyebrow">PATH COMPLETE</div>
          <h2 style={{ marginTop: 8 }}>Every lesson done.</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 11 }}>You finished every lesson on this path. Create a new one to keep the momentum going.</p>
          <Link href="/onboarding" className="btn btn-ghost" style={{ marginTop: 18 }}>Start a new path <ArrowUpRight size={14}/></Link>
        </>}
      </div>
      <div className="card pad" style={{ background: "var(--mint)" }}>
        <div className="eyebrow">VIDEO COVERAGE</div>
        <h2 style={{ marginTop: 8 }}>{videosFound} of {total} lessons matched</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 11 }}>Each lesson on your path is matched with the best YouTube video its search queries can find. Lessons still pending can be retried from your journey.</p>
        <div className="progress" style={{ marginTop: 18 }}><span style={{ width: `${videoPercent}%` }}/></div>
      </div>
    </section>

    <section className={hasOutcome ? "grid grid-2 section" : "section"} aria-label="Practice progress and final outcome status">
      <div className="card pad">
        <div className="eyebrow">PRACTICE PROGRESS</div>
        <h2 style={{ marginTop: 8 }}>{practiceDone} of {practiceTotal} practice concepts cleared</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 11 }}>Every lesson on your path carries a practice concept. Completing the lesson is what clears its practice - there is no separate practice score.</p>
        <div className="progress" style={{ marginTop: 18 }}><span style={{ width: `${practicePercent}%` }}/></div>
        <Link href="/practice" className="btn btn-ghost" style={{ marginTop: 18 }}>Practice now <ArrowUpRight size={14}/></Link>
      </div>
      {hasOutcome && <div className="card pad" style={{ background: "var(--lime)" }}>
        <div className="eyebrow">FINAL OUTCOME STATUS</div>
        <h2 style={{ marginTop: 8 }}>{outcomeLabel(finalOutcome.kind)}: {finalOutcome.title}</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 11 }}>{finalOutcome.objective}</p>
        <div className="progress" style={{ marginTop: 18 }}><span style={{ width: `${percent}%`, background: "#10211b" }}/></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12 }}>
          <strong>{remaining === 0 ? "Ready to complete" : `${remaining} ${remaining === 1 ? "lesson" : "lessons"} to unlock`}</strong>
          <span>{percent}%</span>
        </div>
        <Link href="/projects" className="btn btn-dark" style={{ marginTop: 18 }}>View your {outcomeLabel(finalOutcome.kind).toLowerCase()} <ArrowUpRight size={14}/></Link>
      </div>}
    </section>
  </main>;
}

/** Sample metrics for anonymous demo mode only (frozen sample view). */
function DemoProgress() {
  // Frozen sample skills for anonymous demo mode only (spec part 2) -
  // inline, never from a shared mock-data module.
  const skills = [
    { name: "HTML & CSS", progress: 100, detail: "12 concepts mastered" },
    { name: "JavaScript", progress: 72, detail: "9 of 14 concepts" },
    { name: "Async JavaScript", progress: 31, detail: "Worth another pass" },
    { name: "React", progress: 0, detail: "Complete prerequisites" },
  ];
  return <main className="container">
    <PageHeader eyebrow="Capability over consumption" title="See your progress clearly." description="LearningOS measures the skills you can explain, apply, and revisit — not how many hours you kept a tab open." action={<Link href="/journey" className="btn btn-dark"><Compass size={14}/>View journey</Link>} />
    <div className="hero-grid" style={{ marginTop: 28 }}>
      <div className="card pad lime-surface" style={{ background: "var(--lime)" }}>
        <div className="eyebrow">CURRENT GOAL</div>
        <h2 style={{ fontSize: 31, marginTop: 16 }}>Become a Full-Stack Developer</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Stage 2 of 6 · Building fluency</p>
        <div className="progress" style={{ marginTop: 30 }}><span style={{ width: "38%", background: "#10211b" }}/></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12 }}><strong>38% capability</strong><span>14 concepts left</span></div>
      </div>
      <div className="card pad" style={{ background: "var(--navy)", color: "white" }}>
        <TrendingUp size={22} color="var(--lime)"/>
        <div className="eyebrow" style={{ color: "#a8b8b0", marginTop: 28 }}>LEARNING CONSISTENCY</div>
        <strong style={{ fontSize: 40, display: "block", marginTop: 8 }}>4</strong>
        <p style={{ color: "#c5d0cc", fontSize: 13, lineHeight: 1.5, marginTop: 7 }}>meaningful learning days this week</p>
        <div className="stat-row" style={{ marginTop: 28 }}>
          <div className="stat"><strong>2</strong><span style={{ color: "#a8b8b0", fontSize: 11 }}>milestones</span></div>
          <div className="stat"><strong>8</strong><span style={{ color: "#a8b8b0", fontSize: 11 }}>concepts understood</span></div>
        </div>
      </div>
    </div>
    <div className="grid grid-3 section">
      <div className="card pad metric-card"><div className="eyebrow">SKILLS MASTERED</div><strong>2</strong><p className="muted">Foundations you can use independently.</p></div>
      <div className="card pad metric-card"><div className="eyebrow">CHALLENGES SOLVED</div><strong>12</strong><p className="muted">Decisions made without hints.</p></div>
      <div className="card pad metric-card"><div className="eyebrow">PROJECTS COMPLETED</div><strong>1</strong><p className="muted">A capability made visible in a build.</p></div>
    </div>
    <section className="section">
      <div className="section-head"><div><div className="eyebrow">SKILL MOMENTUM</div><h2 style={{ marginTop: 7 }}>Where your capability is moving.</h2></div></div>
      <div className="card pad">
        {skills.map((skill) => <div className="list-row" key={skill.name}><div style={{ minWidth: 150 }}><strong style={{ fontSize: 13 }}>{skill.name}</strong><p className="muted" style={{ fontSize: 10, marginTop: 4 }}>{skill.detail}</p></div><div style={{ width: "35%", minWidth: 100 }}><div className="progress"><span style={{ width: `${skill.progress}%` }}/></div></div><span className="mono" style={{ fontSize: 11 }}>{skill.progress}%</span></div>)}
      </div>
    </section>
    <section className="grid grid-2 section">
      <div className="card pad">
        <div className="eyebrow">WEAK CONCEPTS</div>
        <h2 style={{ marginTop: 8 }}>Worth a short review</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 11 }}>REST status codes and async error handling are the concepts most likely to slow your next project.</p>
        <Link href="/practice" className="btn btn-ghost" style={{ marginTop: 18 }}>Practice these <ArrowUpRight size={14}/></Link>
      </div>
      <div className="card pad" style={{ background: "var(--mint)" }}>
        <div className="eyebrow">PROJECT READINESS</div>
        <h2 style={{ marginTop: 8 }}>Weather dashboard</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 11 }}>72% ready. Two prerequisite concepts remain before the build will feel fluent.</p>
        <div className="progress" style={{ marginTop: 18 }}><span style={{ width: "72%" }}/></div>
      </div>
    </section>
  </main>;
}
