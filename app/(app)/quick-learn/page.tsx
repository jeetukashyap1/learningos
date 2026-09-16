import Link from "next/link";
import { ArrowUpRight, Clock3, Lightbulb, Play, RotateCcw, Swords, Zap } from "lucide-react";
import { NoLearningPath } from "@/components/no-learning-path";
import { PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser, getCurrentUserState } from "@/lib/auth";
import { isLearningPathError, LearningPathError } from "@/lib/learning-path/errors";
import { loadLearningPathOverview, type LearningPathOverview } from "@/lib/learning-path/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Sample sprints for anonymous demo mode only (frozen sample view). */
const sampleItems = [
  { title: "Understand APIs in 10 minutes", type: "Concept", time: "10 min", icon: Lightbulb, learn: "Requests, responses, and endpoints", matter: "You need this before building your first API." },
  { title: "Fix this JavaScript bug", type: "Challenge", time: "7 min", icon: Swords, learn: "Trace an async error", matter: "Debugging turns confusion into a repeatable skill." },
  { title: "Master CSS Flexbox", type: "Visual explanation", time: "12 min", icon: Play, learn: "Align and distribute a responsive layout", matter: "Clear layout fundamentals make every interface easier." },
  { title: "Revise array methods", type: "Revision", time: "5 min", icon: RotateCcw, learn: "Choose between map, filter, and reduce", matter: "Fast retrieval keeps useful patterns available." },
];

/** Real sprint windows, mapped to the estimated minutes of path lessons. */
const sprintWindows = [
  { id: "all", label: "All", match: () => true },
  { id: "5", label: "5 min", match: (minutes: number) => minutes <= 5 },
  { id: "10", label: "10 min", match: (minutes: number) => minutes <= 10 },
  { id: "15", label: "15 min", match: (minutes: number) => minutes <= 15 },
  { id: "20", label: "20+ min", match: (minutes: number) => minutes >= 20 },
] as const;

type SprintWindowId = (typeof sprintWindows)[number]["id"];

function parseWindow(value: string | string[] | undefined): SprintWindowId {
  const raw = Array.isArray(value) ? value[0] : value;
  return sprintWindows.some((window) => window.id === raw) ? (raw as SprintWindowId) : "all";
}

function capitalizeLevel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * Quick learn (spec part 23): every sprint is a real lesson on the active
 * path, scoped by its actual estimated minutes. Completed lessons become
 * revision sprints. No sample sprints are shown to a signed-in learner.
 */
export default async function QuickLearnPage({ searchParams }: { searchParams?: Promise<{ window?: string | string[] }> }) {
  const user = await getCurrentUser();
  const state = await getCurrentUserState(user);
  const windowId = parseWindow((await searchParams)?.window);

  if (!state.hasLearningPath) {
    return <main className="container">
      <PageHeader eyebrow="Short sessions · Real progress" title="Quick learn" description="Build a sprint around the time you have. Every session tells you what you will learn, why it matters, and what you can do afterward." />
      <NoLearningPath icon={Zap} eyebrow="SPRINTS FOLLOW YOUR PATH" title="No sprints yet." description="Sprints are built from the concepts on your path, scoped to the time you have. Create your path to unlock focused sessions." />
    </main>;
  }

  // Signed-in path holders get real sprints from their lessons; anonymous
  // demo visitors (state.hasLearningPath via the demo cookie) see the
  // frozen sample sprints.
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
      <PageHeader eyebrow="Short sessions · Real progress" title="Quick learn" description="Build a sprint around the time you have. Every session tells you what you will learn, why it matters, and what you can do afterward." />
      <EmptyState icon={Zap} eyebrow="PATH UNAVAILABLE" title="We could not load your path." description={loadError.safeMessage} />
    </main>;
  }

  if (user && overview) {
    return <RealQuickLearn overview={overview} windowId={windowId} />;
  }

  // Defense in depth (spec part 9): a signed-in learner whose path will
  // not load must never fall through to the sample sprints.
  if (user) {
    return <main className="container">
      <PageHeader eyebrow="Short sessions · Real progress" title="Quick learn" description="Build a sprint around the time you have. Every session tells you what you will learn, why it matters, and what you can do afterward." />
      <NoLearningPath icon={Zap} eyebrow="SPRINTS FOLLOW YOUR PATH" title="No sprints yet." description="Sprints are built from the concepts on your path, scoped to the time you have. Create your path to unlock focused sessions." />
    </main>;
  }

  // Anonymous demo mode: the original frozen sample sprints.
  return <DemoQuickLearn />;
}

/** The real sprints: one per path lesson, filtered by the chosen time window. */
function RealQuickLearn({ overview, windowId }: { overview: LearningPathOverview; windowId: SprintWindowId }) {
  const { lessons } = overview;
  const total = lessons.length;
  const activeWindow = sprintWindows.find((window) => window.id === windowId) ?? sprintWindows[0];
  const sprints = lessons.filter((lesson) => activeWindow.match(lesson.estimated_minutes));

  return <main className="container">
    <PageHeader
      eyebrow="Short sessions · Real progress"
      title="Quick learn"
      description="Build a sprint around the time you have. Every session tells you what you will learn, why it matters, and what you can do afterward."
      action={<Link href="/quick-learn?window=10" className="btn btn-dark"><Clock3 size={14} />Build a 10-min sprint</Link>}
    />

    {total === 0 ? <section className="card pad">
      <div className="eyebrow">YOUR SPRINTS</div>
      <p className="muted" style={{ marginTop: 10 }}>Your lessons are still being prepared. Refresh in a moment and your first sprints appear here.</p>
    </section> : <>
      <div className="sprint-bar">
        <div>
          <div className="eyebrow">CHOOSE YOUR WINDOW</div>
          <strong>One focused session. One useful capability.</strong>
        </div>
        <div className="sprint-filters">
          {sprintWindows.map((window) => (
            <Link href={window.id === "all" ? "/quick-learn" : `/quick-learn?window=${window.id}`} className={`btn ${window.id === windowId ? "btn-dark" : "btn-ghost"}`} key={window.id}>
              {window.label}
            </Link>
          ))}
        </div>
      </div>

      {sprints.length === 0 ? <section className="card pad">
        <div className="eyebrow">NO SPRINTS IN THIS WINDOW</div>
        <p className="muted" style={{ marginTop: 10 }}>No lessons on your path fit the {activeWindow.label} window right now. Try a wider window — your full route is on your journey.</p>
        <Link href="/quick-learn" className="btn btn-ghost" style={{ marginTop: 16 }}>Show all sprints</Link>
      </section> : <div className="grid grid-2">
        {sprints.map((lesson) => {
          const done = lesson.completed_at != null;
          return <article className="card pad sprint-card" key={lesson.id}>
            <div className="sprint-card-top">
              <div className="move-icon" style={{ background: done ? "var(--peach)" : "var(--mint)" }}>
                {done ? <RotateCcw size={22} /> : <Play size={22} />}
              </div>
              <span className="mono muted" style={{ fontSize: 10 }}>{lesson.estimated_minutes} min</span>
            </div>
            <span className="tag" style={{ marginTop: 23 }}>{done ? "Revision" : capitalizeLevel(lesson.level)}</span>
            <h3 style={{ fontSize: 19, marginTop: 12 }}>{lesson.title}</h3>
            <dl className="sprint-details">
              <div>
                <dt>WHAT YOU WILL LEARN</dt>
                <dd>{lesson.objective || lesson.description}</dd>
              </div>
              <div>
                <dt>WHY IT MATTERS</dt>
                <dd>{lesson.goal_relevance || lesson.objective}</dd>
              </div>
              <div>
                <dt>AFTERWARD</dt>
                <dd>{lesson.practical_outcome || "You will be able to take the next step with less guesswork."}</dd>
              </div>
            </dl>
            <Link href={`/learn/${lesson.id}`} className="btn btn-ghost" style={{ marginTop: 20 }}>
              {done ? "Revise sprint" : "Start sprint"} <ArrowUpRight size={14} />
            </Link>
          </article>;
        })}
      </div>}
    </>}
  </main>;
}

/** Anonymous demo mode only: the frozen sample sprints. */
function DemoQuickLearn() {
  return (
    <main className="container">
      <PageHeader
        eyebrow="Short sessions · Real progress"
        title="Quick learn"
        description="Build a sprint around the time you have. Every session tells you what you will learn, why it matters, and what you can do afterward."
        action={
          <button type="button" className="btn btn-dark">
            <Clock3 size={14} />
            Build a 10-min sprint
          </button>
        }
      />
      <div className="sprint-bar">
        <div>
          <div className="eyebrow">CHOOSE YOUR WINDOW</div>
          <strong>One focused session. One useful capability.</strong>
        </div>
        <div className="sprint-filters">
          {["All", "5 min", "10 min", "15 min", "20+ min"].map((filter, i) => (
            <button type="button" className={`btn ${i === 0 ? "btn-dark" : "btn-ghost"}`} key={filter}>
              {filter}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-2">
        {sampleItems.map(({ title, type, time, icon: Icon, learn, matter }, i) => (
          <article className="card pad sprint-card" key={title}>
            <div className="sprint-card-top">
              <div className="move-icon" style={{ background: i === 1 ? "var(--peach)" : "var(--mint)" }}>
                <Icon size={22} />
              </div>
              <span className="mono muted" style={{ fontSize: 10 }}>
                {time}
              </span>
            </div>
            <span className="tag" style={{ marginTop: 23 }}>
              {type}
            </span>
            <h3 style={{ fontSize: 19, marginTop: 12 }}>{title}</h3>
            <dl className="sprint-details">
              <div>
                <dt>WHAT YOU WILL LEARN</dt>
                <dd>{learn}</dd>
              </div>
              <div>
                <dt>WHY IT MATTERS</dt>
                <dd>{matter}</dd>
              </div>
              <div>
                <dt>AFTERWARD</dt>
                <dd>You will be able to take the next step with less guesswork.</dd>
              </div>
            </dl>
            <Link href="/learn/rest-methods" className="btn btn-ghost" style={{ marginTop: 20 }}>
              Start sprint <ArrowUpRight size={14} />
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}
