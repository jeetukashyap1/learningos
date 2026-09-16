import Link from "next/link";
import { ArrowUpRight, Check, Clock3, FolderKanban, LockKeyhole, Rocket, Sparkles } from "lucide-react";
import { NoLearningPath } from "@/components/no-learning-path";
import { PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser, getCurrentUserState } from "@/lib/auth";
import { isLearningPathError, LearningPathError } from "@/lib/learning-path/errors";
import { loadLearningPathOverview, type FinalOutcome, type LearningPathLessonRow, type LearningPathModule, type LearningPathOverview } from "@/lib/learning-path/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Sample projects for anonymous demo mode only (frozen sample view). */
const sampleProjects = [
  { title: "Real-Time Weather Dashboard", description: "Build a weather interface that fetches, transforms, and renders live data.", difficulty: "Intermediate", time: "3–5 hours", progress: 42, skills: ["Async JavaScript", "DOM", "API basics"] },
  { title: "Expense Tracker", description: "Turn local data into a useful personal finance tool with filters and totals.", difficulty: "Beginner", time: "2–3 hours", progress: 0, skills: ["JavaScript", "Forms", "CSS"] },
  { title: "REST API", description: "Design a clean backend service with resource routes and meaningful responses.", difficulty: "Advanced", time: "5–7 hours", progress: 0, skills: ["Node.js", "HTTP", "Databases"] },
];

/** How many proving-ground cards to show before pointing at the journey. */
const MAX_PROJECT_CARDS = 6;

function capitalizeLevel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * Projects that prove it: the final outcome is whatever the generated
 * curriculum actually ends in — a project for build goals, an assessment
 * for academic subjects, a mock interview for language goals, and so on
 * (never a forced "Full-Stack Project"). Every proving ground is a real
 * lesson's practical outcome on the active path, grouped under its real
 * module. Capability state comes only from completed lessons — nothing is
 * invented and no sample projects are shown to a signed-in learner.
 */
export default async function ProjectsPage() {
  const user = await getCurrentUser();
  const state = await getCurrentUserState(user);

  if (!state.hasLearningPath) {
    return <main className="container">
      <PageHeader eyebrow="Real-world application" title="Projects that prove it." description="Turn concepts into something useful. Each project is scoped to stretch your current skills without hiding the next step." />
      <NoLearningPath icon={FolderKanban} eyebrow="YOUR FIRST PROJECT COMES AFTER THE PATH" title="No projects yet." description="Projects prove the skills you build. Work through your path and your first project brief unlocks here." />
    </main>;
  }

  // Signed-in path holders get their real proving grounds; anonymous demo
  // visitors (state.hasLearningPath via the demo cookie) see the frozen
  // sample projects.
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
      <PageHeader eyebrow="Real-world application" title="Projects that prove it." description="Turn concepts into something useful. Each project is scoped to stretch your current skills without hiding the next step." />
      <EmptyState icon={FolderKanban} eyebrow="PATH UNAVAILABLE" title="We could not load your path." description={loadError.safeMessage} />
    </main>;
  }

  if (user && overview) {
    return <RealProjects overview={overview} />;
  }

  // Defense in depth (spec part 9): a signed-in learner whose path will
  // not load must never fall through to the sample projects.
  if (user) {
    return <main className="container">
      <PageHeader eyebrow="Real-world application" title="Projects that prove it." description="Turn concepts into something useful. Each project is scoped to stretch your current skills without hiding the next step." />
      <NoLearningPath icon={FolderKanban} eyebrow="YOUR FIRST PROJECT COMES AFTER THE PATH" title="No projects yet." description="Projects prove the skills you build. Work through your path and your first project brief unlocks here." />
    </main>;
  }

  // Anonymous demo mode: the original frozen sample projects.
  return <DemoProjects />;
}

/** Hero label for the outcome kind — labeling only; the kind and content come from the generated curriculum. */
const OUTCOME_HERO_LABELS: Record<string, string> = {
  project: "YOUR FINAL PROJECT",
  assessment: "YOUR FINAL ASSESSMENT",
  "mock-exam": "YOUR MOCK EXAM",
  "mock-interview": "YOUR MOCK INTERVIEW",
  "case-study": "YOUR CASE STUDY",
  presentation: "YOUR RESEARCH PRESENTATION",
  portfolio: "YOUR PORTFOLIO",
  other: "YOUR FINAL OUTCOME",
};

function heroLabel(kind: string): string {
  return OUTCOME_HERO_LABELS[kind] ?? "YOUR FINAL OUTCOME";
}

/** The real proving grounds: the domain-appropriate final outcome plus each lesson's practical outcome, grouped by module. */
function RealProjects({ overview }: { overview: LearningPathOverview }) {
  const { path, lessons, modules, finalOutcome, completedLessonCount, nextLessonId } = overview;
  const total = lessons.length;
  const percent = total > 0 ? Math.round((completedLessonCount / total) * 100) : 0;
  const shown = lessons.slice(0, MAX_PROJECT_CARDS);
  const hidden = total - shown.length;
  const hasOutcome = finalOutcome.kind !== "";
  const isProject = finalOutcome.kind === "project";
  const startHref = nextLessonId ? `/learn/${nextLessonId}` : "/journey";

  const moduleSections = modules
    .map((module) => ({ module, moduleLessons: shown.filter((lesson) => lesson.module_id === module.id) }))
    .filter((section) => section.moduleLessons.length > 0);
  const moduleLessonIds = new Set(modules.flatMap((module) => module.lessons.map((lesson) => lesson.id)));
  const ungrouped = shown.filter((lesson) => !moduleLessonIds.has(lesson.id));
  const hasModules = moduleSections.length > 0;

  return <main className="container">
    <PageHeader
      eyebrow="Real-world application"
      title={isProject || !hasOutcome ? "Projects that prove it." : "Your proving ground."}
      description={isProject || !hasOutcome
        ? "Turn concepts into something useful. Each project is scoped to stretch your current skills without hiding the next step."
        : `Your ${path.subject || path.topic} path ends in its own proving ground — and every lesson along the way prepares you for it.`}
    />

    {total === 0 ? <section className="card pad">
      <div className="eyebrow">YOUR PROVING GROUNDS</div>
      <p className="muted" style={{ marginTop: 10 }}>Your lessons are still being prepared. Refresh in a moment and your first briefs appear here.</p>
    </section> : <>
      {hasOutcome
        ? <FinalOutcomeHero outcome={finalOutcome} modules={modules} completedLessonCount={completedLessonCount} total={total} percent={percent} startHref={startHref} startLabel={isProject ? "Start project" : "Start preparation"} />
        : <section className="card pad" style={{ background: "var(--navy)", color: "white", marginBottom: 28 }}>
            <div className="eyebrow" style={{ color: "var(--lime)" }}>YOUR FINAL OUTCOME</div>
            <h2 style={{ marginTop: 8, color: "white" }}>{path.goal || path.title}</h2>
            <p style={{ color: "#c5d0cc", fontSize: 13, lineHeight: 1.6, marginTop: 10, maxWidth: 560 }}>
              {path.description || `Every lesson on your ${path.subject || path.topic} path builds toward this outcome.`}
            </p>
            <div style={{ marginTop: 22, fontSize: 12 }}>{completedLessonCount} of {total} lessons complete</div>
            <div className="progress" style={{ marginTop: 9 }}><span style={{ width: `${percent}%` }} /></div>
          </section>}

      {hasModules ? <>
        {moduleSections.map(({ module, moduleLessons }, sectionIndex) => <section key={module.id} style={{ marginBottom: 26 }}>
          <div className="eyebrow" style={{ color: "var(--orange)" }}>MODULE {module.orderIndex} · {module.title}</div>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            {moduleLessons.map((lesson, index) => <ProjectCard key={lesson.id} lesson={lesson} lead={sectionIndex === 0 && index === 0} />)}
          </div>
        </section>)}
        {ungrouped.length > 0 && <div className="grid grid-2">
          {ungrouped.map((lesson) => <ProjectCard key={lesson.id} lesson={lesson} lead={false} />)}
        </div>}
      </> : <div className="grid grid-2">
        {shown.map((lesson, index) => <ProjectCard key={lesson.id} lesson={lesson} lead={index === 0} />)}
      </div>}

      {hidden > 0 && <p className="muted" style={{ fontSize: 12, marginTop: 18 }}>
        +{hidden} more proving ground{hidden === 1 ? "" : "s"} along your path — your journey shows the full route.
      </p>}
    </>}

    <div className="card pad section" style={{ background: "var(--navy)", color: "white", display: "flex", alignItems: "center", gap: 15 }}>
      <LockKeyhole size={20} color="var(--lime)" />
      <div>
        <h3>Proving grounds unlock through capability, not time.</h3>
        <p style={{ color: "#c5d0cc", fontSize: 12, marginTop: 6 }}>Finish the prerequisites and the next proving ground becomes yours.</p>
      </div>
    </div>
  </main>;
}

/** The final outcome hero: why it matters, what it demonstrates, requirements, milestones, related modules, and estimated time — all from the generated curriculum. */
function FinalOutcomeHero({ outcome, modules, completedLessonCount, total, percent, startHref, startLabel }: {
  outcome: FinalOutcome;
  modules: LearningPathModule[];
  completedLessonCount: number;
  total: number;
  percent: number;
  startHref: string;
  startLabel: string;
}) {
  return (
    <section className="card pad" style={{ background: "var(--navy)", color: "white", marginBottom: 28 }}>
      <div className="eyebrow" style={{ color: "var(--lime)" }}>{heroLabel(outcome.kind)}</div>
      <h2 style={{ marginTop: 8, color: "white" }}>{outcome.title}</h2>
      {outcome.description && <p style={{ color: "#c5d0cc", fontSize: 13, lineHeight: 1.6, marginTop: 10, maxWidth: 620 }}>{outcome.description}</p>}
      {outcome.objective && <p style={{ color: "#c5d0cc", fontSize: 13, lineHeight: 1.6, marginTop: 10, maxWidth: 620 }}>
        <strong style={{ color: "white" }}>What it demonstrates: </strong>{outcome.objective}
      </p>}
      {(outcome.requirements.length > 0 || outcome.milestones.length > 0) && <div className="grid grid-2" style={{ marginTop: 16, gap: 18 }}>
        {outcome.requirements.length > 0 && <div>
          <div className="eyebrow" style={{ color: "var(--lime)" }}>REQUIREMENTS</div>
          <ul style={{ color: "#c5d0cc", fontSize: 12, lineHeight: 1.7, marginTop: 8, paddingLeft: 18 }}>
            {outcome.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
          </ul>
        </div>}
        {outcome.milestones.length > 0 && <div>
          <div className="eyebrow" style={{ color: "var(--lime)" }}>MILESTONES</div>
          <ol style={{ color: "#c5d0cc", fontSize: 12, lineHeight: 1.7, marginTop: 8, paddingLeft: 18 }}>
            {outcome.milestones.map((milestone) => <li key={milestone}>{milestone}</li>)}
          </ol>
        </div>}
      </div>}
      {modules.length > 0 && <div style={{ marginTop: 18 }}>
        <div className="eyebrow" style={{ color: "var(--lime)" }}>BUILT FROM</div>
        <p style={{ color: "#c5d0cc", fontSize: 12, lineHeight: 1.7, marginTop: 6 }}>
          {modules.map((module) => `Module ${module.orderIndex}: ${module.title}`).join(" · ")}
        </p>
      </div>}
      <div style={{ marginTop: 20, fontSize: 12 }}>{completedLessonCount} of {total} lessons complete</div>
      <div className="progress" style={{ marginTop: 9 }}><span style={{ width: `${percent}%` }} /></div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 18, flexWrap: "wrap" }}>
        {outcome.estimatedMinutes > 0 && <span style={{ fontSize: 12, color: "#c5d0cc", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Clock3 size={12} /> {outcome.estimatedMinutes} min estimated
        </span>}
        {outcome.expectedResult && <span style={{ fontSize: 12, color: "#c5d0cc", maxWidth: 420 }}>{outcome.expectedResult}</span>}
        <Link href={startHref} className="btn" style={{ marginLeft: "auto" }}>
          {startLabel} <ArrowUpRight size={14} />
        </Link>
      </div>
    </section>
  );
}

/** One proving-ground card: a real lesson's practical outcome. */
function ProjectCard({ lesson, lead }: { lesson: LearningPathLessonRow; lead: boolean }) {
  const done = lesson.completed_at != null;
  return <article className="card pad project-card">
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <div className="move-icon" style={{ background: done ? "var(--lime)" : "var(--mint)", color: "var(--ink)" }}>
        {done ? <Check size={22} /> : lead ? <Rocket size={22} /> : <Sparkles size={22} />}
      </div>
      <span className="tag">{capitalizeLevel(lesson.level)}</span>
    </div>
    <h2 style={{ fontSize: 22, marginTop: 24 }}>{lesson.practical_outcome || lesson.title}</h2>
    <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 9 }}>{lesson.objective || lesson.description}</p>
    <div className="project-meta">
      <span><Clock3 size={12} /> {lesson.estimated_minutes} min lesson</span>
      <span>{done ? "Capability proven" : "Unlocks with the lesson"}</span>
    </div>
    <p className="project-skills"><strong>Skills used</strong> {lesson.concepts.length > 0 ? lesson.concepts.join(" · ") : lesson.skill || lesson.topic}</p>
    <p className="project-prereq"><strong>Prerequisites</strong> {lesson.prerequisites.length > 0 ? lesson.prerequisites.join(" · ") : "None — start here"}</p>
    <div className="progress" style={{ marginTop: 13 }}><span style={{ width: `${done ? 100 : 0}%` }} /></div>
    <Link href={`/learn/${lesson.id}`} className="btn btn-ghost" style={{ marginTop: 18, alignSelf: "start" }}>
      {done ? "Review the lesson" : "Open the lesson"} <ArrowUpRight size={14} />
    </Link>
  </article>;
}

/** Anonymous demo mode only: the frozen sample projects. */
function DemoProjects() {
  return <main className="container">
    <PageHeader eyebrow="Real-world application" title="Projects that prove it." description="Turn concepts into something useful. Each project is scoped to stretch your current skills without hiding the next step." action={<button type="button" className="btn btn-dark"><Sparkles size={14} />Suggest a project</button>} />
    <div className="grid grid-2" style={{ marginTop: 28 }}>
      {sampleProjects.map((project, index) => {
        const readiness = project.progress || 18;
        return <article className="card pad project-card" key={project.title}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div className="move-icon" style={{ background: index === 0 ? "var(--lime)" : "var(--mint)", color: "var(--ink)" }}>{index === 0 ? <Rocket size={22} /> : <Sparkles size={22} />}</div>
            <span className="tag">{project.difficulty}</span>
          </div>
          <h2 style={{ fontSize: 22, marginTop: 24 }}>{project.title}</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginTop: 9 }}>{project.description}</p>
          <div className="project-meta"><span><Clock3 size={12} /> {project.time}</span><span>Readiness {readiness}%</span></div>
          <p className="project-skills"><strong>Skills used</strong> {project.skills.join(" · ")}</p>
          <p className="project-prereq"><strong>Prerequisites</strong> Async JavaScript · REST methods</p>
          <div className="progress" style={{ marginTop: 13 }}><span style={{ width: `${readiness}%` }} /></div>
        </article>;
      })}
    </div>
    <div className="card pad section" style={{ background: "var(--navy)", color: "white", display: "flex", alignItems: "center", gap: 15 }}>
      <LockKeyhole size={20} color="var(--lime)" />
      <div>
        <h3>Projects unlock through capability, not time.</h3>
        <p style={{ color: "#c5d0cc", fontSize: 12, marginTop: 6 }}>Finish the prerequisites and the right project becomes your next proving ground.</p>
      </div>
    </div>
  </main>;
}
