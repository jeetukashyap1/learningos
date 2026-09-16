import { Check, Compass, LockKeyhole, MapPin, Play } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { NoLearningPath } from "@/components/no-learning-path";
import { getCurrentUser, getCurrentUserState } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLearningPathError, LearningPathError } from "@/lib/learning-path/errors";
import { loadLearningPathOverview, type FinalOutcome, type LearningPathLessonRow, type LearningPathModule, type LearningPathOverview } from "@/lib/learning-path/service";
import { RetryVideosButton } from "./retry-videos-button";

/** Sample route stages for anonymous demo mode only (frozen sample view). */
const milestones = [
  { label: "Foundation", title: "Web Basics", state: "done", detail: "HTML, CSS, browser basics" },
  { label: "Current stage", title: "JavaScript", state: "active", detail: "Build fluency with the language" },
  { label: "Next up", title: "Frontend", state: "next", detail: "React and interface architecture" },
  { label: "Upcoming", title: "Backend", state: "locked", detail: "APIs, servers, databases" },
  { label: "Upcoming", title: "Projects", state: "locked", detail: "Make things that matter" },
];

/**
 * The learner's journey, from real data: the persisted path, its
 * AI-generated modules with lessons and completion state, current/next
 * lesson, video-attachment status, and the domain-appropriate final
 * outcome. No mock data is shown to a signed-in learner - the demo
 * milestone view remains only for anonymous demo mode, which always has
 * sample data.
 */
export default async function JourneyPage() {
  const user = await getCurrentUser();
  const state = await getCurrentUserState(user);

  if (!state.hasLearningPath) {
    return <main className="container">
      <PageHeader eyebrow="Your personalized path" title="My journey" description="A clear route from where you are to where you want to be. It starts with a learning path." />
      <NoLearningPath icon={Compass} eyebrow="YOUR JOURNEY STARTS WITH A PATH" title="No route yet." description="Your journey maps the stages between you and your goal. Create a learning path and this page becomes your map." />
    </main>;
  }

  // Signed-in path holders get their real path; anonymous demo visitors
  // (state.hasLearningPath via the demo cookie) see the sample route.
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
      <PageHeader eyebrow="Your personalized path" title="My journey" description="A clear route from where you are to where you want to be." />
      <EmptyState icon={Compass} eyebrow="PATH UNAVAILABLE" title="We could not load your path." description={loadError.safeMessage} />
    </main>;
  }

  if (user && overview) {
    return <RealJourney overview={overview} />;
  }

  // Defense in depth (spec part 9): a signed-in learner whose path will
  // not load must never fall through to the sample route, whatever the
  // flags said. The honest no-path state is the only real-user fallback.
  if (user) {
    return <main className="container">
      <PageHeader eyebrow="Your personalized path" title="My journey" description="A clear route from where you are to where you want to be. It starts with a learning path." />
      <NoLearningPath icon={Compass} eyebrow="YOUR JOURNEY STARTS WITH A PATH" title="No route yet." description="Your journey maps the stages between you and your goal. Create a learning path and this page becomes your map." />
    </main>;
  }

  // Anonymous demo mode: the original sample route (frozen experience).
  return <main className="container"><PageHeader eyebrow="Your personalized path" title="My journey" description="A clear route from where you are now to becoming a full-stack developer. Every stage unlocks when the foundations are ready." /><section className="card pad" style={{ background: "var(--navy)", color: "white", marginBottom: 22 }}><div className="eyebrow" style={{ color: "var(--lime)" }}>Current goal</div><h2 style={{ fontSize: 32, marginTop: 12 }}>Become a Full-Stack Developer</h2><div style={{ display: "flex", gap: 30, marginTop: 24, color: "#b5c3bd", fontSize: 12 }}><span><strong style={{ color: "white", fontSize: 20, display: "block" }}>38%</strong>complete</span><span><strong style={{ color: "white", fontSize: 20, display: "block" }}>Stage 2</strong>of 6</span><span><strong style={{ color: "white", fontSize: 20, display: "block" }}>14</strong>concepts left</span></div></section><div className="card pad" style={{ overflow: "hidden" }}><div className="eyebrow">The route</div><div style={{ display: "grid", gridTemplateColumns: `repeat(${milestones.length}, 1fr)`, gap: 0, marginTop: 50 }}>{milestones.map((item, index) => <div key={item.title} style={{ position: "relative", textAlign: "center" }}><div style={{ position: "absolute", height: 2, background: index < milestones.length - 1 && milestones[index + 1].state !== "locked" ? "var(--orange)" : "var(--line)", left: "50%", right: index === milestones.length - 1 ? "50%" : "-50%", top: 25, zIndex: 0 }} /><div style={{ width: 52, height: 52, borderRadius: "50%", margin: "0 auto", display: "grid", placeItems: "center", position: "relative", zIndex: 1, background: item.state === "active" ? "var(--orange)" : item.state === "done" ? "var(--lime)" : "#edf1eb" }}>{item.state === "done" ? <Check size={20} /> : item.state === "locked" ? <LockKeyhole size={17} color="#839087" /> : <MapPin size={19} color={item.state === "active" ? "white" : "var(--ink)"} />}</div><div className="eyebrow" style={{ marginTop: 18, color: item.state === "active" ? "var(--orange)" : undefined }}>{item.label}</div><strong style={{ display: "block", fontSize: 13, marginTop: 6 }}>{item.title}</strong><p className="muted" style={{ fontSize: 11, marginTop: 4 }}>{item.detail}</p></div>)}</div></div></main>;
}

/** Human labels for the AI-chosen outcome kind (labeling only - the kind and all content come from the generated curriculum). */
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

/** The real journey: persisted path, AI-generated modules with lessons, true progress, and the final outcome. */
function RealJourney({ overview }: { overview: LearningPathOverview }) {
  const { path, lessons, modules, finalOutcome, nextLessonId, completedLessonCount } = overview;
  const total = lessons.length;
  const percent = total > 0 ? Math.round((completedLessonCount / total) * 100) : 0;
  const nextLesson = lessons.find((lesson) => lesson.id === nextLessonId) ?? null;
  const pendingVideos = lessons.filter((lesson) => lesson.resource_status === "pending").length;
  const hasModules = modules.length > 0;
  const moduleLessonIds = new Set(modules.flatMap((module) => module.lessons.map((lesson) => lesson.id)));
  const ungroupedLessons = lessons.filter((lesson) => !moduleLessonIds.has(lesson.id));
  const allLessonsDone = total > 0 && completedLessonCount === total;

  return <main className="container">
    <PageHeader eyebrow="Your personalized path" title="My journey" description={path.description || "A clear route from where you are to where you want to be."} />

    <section className="card pad" style={{ background: "var(--navy)", color: "white", marginBottom: 22 }}>
      <div className="eyebrow" style={{ color: "var(--lime)" }}>Your learning path</div>
      <h2 style={{ fontSize: 32, marginTop: 12 }}>{path.title}</h2>
      {path.goal && <p style={{ marginTop: 10, color: "#b5c3bd", fontSize: 13, maxWidth: 640, lineHeight: 1.6 }}>{path.goal}</p>}
      <div style={{ display: "flex", gap: 30, marginTop: 24, color: "#b5c3bd", fontSize: 12, flexWrap: "wrap" }}>
        <span><strong style={{ color: "white", fontSize: 20, display: "block" }}>{percent}%</strong>complete</span>
        <span><strong style={{ color: "white", fontSize: 20, display: "block" }}>{completedLessonCount} of {total}</strong>lessons done</span>
        {hasModules && <span><strong style={{ color: "white", fontSize: 20, display: "block" }}>{modules.length}</strong>modules</span>}
        <span><strong style={{ color: "white", fontSize: 20, display: "block" }}>{path.estimated_days}</strong>day estimate</span>
      </div>
    </section>

    {nextLesson && pendingVideos > 0 && <section className="card pad" style={{ marginBottom: 22, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <Play size={18} color="var(--orange)" aria-hidden="true" />
      <p style={{ fontSize: 13, flex: 1, minWidth: 220 }}>
        {pendingVideos === total
          ? "Videos for your lessons are still being matched — start with the first lesson while they finish loading."
          : "Some lessons are still waiting for their videos — they finish loading in the background."}
      </p>
      <RetryVideosButton />
    </section>}

    {hasModules ? <>
      {modules.map((module) => <ModuleSection key={module.id} module={module} nextLessonId={nextLessonId} />)}
      {ungroupedLessons.length > 0 && <section className="card pad" style={{ marginBottom: 22 }}>
        <div className="eyebrow">More lessons</div>
        <div style={{ display: "grid", gap: 0, marginTop: 12 }}>
          {ungroupedLessons.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} isNext={lesson.id === nextLessonId} />)}
        </div>
      </section>}
    </> : <div className="card pad" style={{ overflow: "hidden" }}>
      <div className="eyebrow">Your lessons</div>
      <div style={{ display: "grid", gap: 0, marginTop: 18 }}>
        {lessons.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} isNext={lesson.id === nextLessonId} />)}
      </div>
    </div>}

    {finalOutcome.kind !== "" && <FinalOutcomeCard outcome={finalOutcome} allLessonsDone={allLessonsDone} />}
  </main>;
}

/** One module: real title/description/objective from the generated curriculum, with progress derived from actual lesson completion. */
function ModuleSection({ module, nextLessonId }: { module: LearningPathModule; nextLessonId: string | null }) {
  const total = module.lessons.length;
  const done = module.lessons.filter((lesson) => lesson.completed_at != null).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return <section className="card pad" style={{ marginBottom: 22 }} aria-label={`Module ${module.orderIndex}: ${module.title}`}>
    <div className="eyebrow" style={{ color: "var(--orange)" }}>Module {module.orderIndex}</div>
    <h3 style={{ fontSize: 20, marginTop: 10 }}>{module.title}</h3>
    {module.description && <p className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>{module.description}</p>}
    {module.objective && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}><strong style={{ color: "var(--ink)" }}>Objective:</strong> {module.objective}</p>}
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
      <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>{done} of {total} lessons · {percent}%</span>
      <div aria-hidden="true" style={{ flex: 1, minWidth: 120, height: 6, borderRadius: 3, background: "#edf1eb", overflow: "hidden" }}>
        <div style={{ width: `${percent}%`, height: "100%", background: "var(--lime)" }} />
      </div>
      <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>{module.estimatedMinutes} min</span>
    </div>
    <div style={{ display: "grid", gap: 0, marginTop: 10 }}>
      {module.lessons.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} isNext={lesson.id === nextLessonId} />)}
    </div>
  </section>;
}

/** A single lesson row in the journey: check when done, play marker when next up, open circle otherwise. */
function LessonRow({ lesson, isNext }: { lesson: LearningPathLessonRow; isNext: boolean }) {
  const done = lesson.completed_at != null;
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "16px 4px", borderTop: "1px solid var(--line)" }} className="list-row">
      <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0, background: done ? "var(--lime)" : isNext ? "var(--orange)" : "#edf1eb" }}>
        {done ? <Check size={16} /> : isNext ? <Play size={12} color="white" /> : <span className="mono" style={{ fontSize: 11, fontWeight: 800 }}>{lesson.lesson_order}</span>}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: 13, display: "block" }}>{lesson.title}{isNext && <span className="tag" style={{ marginLeft: 8 }}>Next up</span>}</strong>
        <small className="muted" style={{ fontSize: 12, display: "block", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis" }}>{lesson.description}</small>
        <small className="muted" style={{ fontSize: 11, display: "block", marginTop: 5 }}>
          {lesson.estimated_minutes} min · {lesson.level}
          {lesson.skill ? ` · ${lesson.skill}` : ""}
          {lesson.resource_status === "found" ? " · video ready" : lesson.resource_status === "unavailable" ? " · no video found" : " · video loading"}
        </small>
      </span>
      <Link href={`/learn/${lesson.id}`} className="btn btn-ghost" style={{ fontSize: 11, padding: "8px 12px", flexShrink: 0 }}>{done ? "Review" : "Open"}</Link>
    </div>
  );
}

/** The final outcome: the domain-appropriate finish line from the generated curriculum. */
function FinalOutcomeCard({ outcome, allLessonsDone }: { outcome: FinalOutcome; allLessonsDone: boolean }) {
  const label = outcomeLabel(outcome.kind);
  return (
    <section className="card pad" style={{ background: "var(--lime)" }} aria-label={label}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="eyebrow" style={{ marginTop: 0 }}>Final outcome</div>
        <span className="tag" style={{ marginLeft: "auto" }}>{allLessonsDone ? "Ready to complete" : "Unlocks when lessons are done"}</span>
      </div>
      <h3 style={{ fontSize: 22, marginTop: 10 }}>{label}: {outcome.title}</h3>
      {outcome.description && <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>{outcome.description}</p>}
      {outcome.objective && <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}><strong>Objective:</strong> {outcome.objective}</p>}
      {(outcome.requirements.length > 0 || outcome.milestones.length > 0) && <div className="grid grid-2" style={{ marginTop: 16, gap: 18 }}>
        {outcome.requirements.length > 0 && <div>
          <div className="eyebrow" style={{ marginTop: 0 }}>Requirements</div>
          <ul style={{ marginTop: 8, display: "grid", gap: 6, fontSize: 13, lineHeight: 1.5, paddingLeft: 18 }}>
            {outcome.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
          </ul>
        </div>}
        {outcome.milestones.length > 0 && <div>
          <div className="eyebrow" style={{ marginTop: 0 }}>Milestones</div>
          <ol style={{ marginTop: 8, display: "grid", gap: 6, fontSize: 13, lineHeight: 1.5, paddingLeft: 18 }}>
            {outcome.milestones.map((milestone) => <li key={milestone}>{milestone}</li>)}
          </ol>
        </div>}
      </div>}
      {outcome.expectedResult && <p style={{ marginTop: 14, fontSize: 13, lineHeight: 1.6 }}><strong>Expected result:</strong> {outcome.expectedResult}</p>}
      {outcome.estimatedMinutes > 0 && <small style={{ display: "block", marginTop: 10, fontSize: 12 }}>Estimated time: {outcome.estimatedMinutes} min</small>}
    </section>
  );
}
