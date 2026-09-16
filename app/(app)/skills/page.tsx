import { ArrowDown, Check, LockKeyhole, Map as MapIcon } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { LearningResources } from "@/components/learning-resources";
import { NoLearningPath } from "@/components/no-learning-path";
import { getCurrentUser, getCurrentUserState } from "@/lib/auth";
import { isLearningPathError, LearningPathError } from "@/lib/learning-path/errors";
import { loadLearningPathOverview, type LearningPathOverview } from "@/lib/learning-path/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Sample map for anonymous demo mode only (frozen sample view). */
const sampleNodes = [
  { name: "JavaScript", state: "done", detail: "Foundations" },
  { name: "Async Programming", state: "done", detail: "Promises + async/await" },
  { name: "APIs", state: "active", detail: "Requests and responses" },
  { name: "REST", state: "active", detail: "Your next concept" },
  { name: "Authentication", state: "locked", detail: "Coming after REST" },
  { name: "Full-Stack Project", state: "locked", detail: "Apply the path" },
] as const;

/** Sample mastery rows for anonymous demo mode only. */
const sampleSkills = [
  { name: "HTML & CSS", progress: 100, detail: "12 concepts mastered" },
  { name: "JavaScript", progress: 72, detail: "9 of 14 concepts" },
  { name: "Async JavaScript", progress: 31, detail: "Worth another pass" },
  { name: "React", progress: 0, detail: "Complete prerequisites" },
];

function isLessonLevel(value: string): value is "beginner" | "intermediate" | "advanced" {
  return value === "beginner" || value === "intermediate" || value === "advanced";
}

/**
 * The skill map, derived from the persisted curriculum (spec part 18):
 * every node is a real lesson on the active path in its recommended
 * order, mastery is computed only from completed lessons, and the next
 * prerequisite is the next incomplete lesson. No percentages are
 * invented and no sample skills are shown to a signed-in learner.
 */
export default async function SkillsPage() {
  const user = await getCurrentUser();
  const state = await getCurrentUserState(user);

  if (!state.hasLearningPath) {
    return <main className="container">
      <PageHeader eyebrow="Knowledge map · Connected concepts" title="Skill map" description="See the prerequisites behind your progress. Each node makes the next useful action easier to choose." />
      <NoLearningPath icon={MapIcon} eyebrow="YOUR SKILL MAP IS WAITING" title="No skills mapped yet." description="Your skill map connects concepts to your goal, one node at a time. Create a learning path and your first nodes appear here." />
      {user?.onboardingTopic ? <LearningResources query={user.onboardingTopic} /> : null}
    </main>;
  }

  // Signed-in path holders get their real map; anonymous demo visitors
  // (state.hasLearningPath via the demo cookie) see the sample map.
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
      <PageHeader eyebrow="Knowledge map · Connected concepts" title="Skill map" description="See the prerequisites behind your progress. Each node makes the next useful action easier to choose." />
      <EmptyState icon={MapIcon} eyebrow="PATH UNAVAILABLE" title="We could not load your path." description={loadError.safeMessage} />
    </main>;
  }

  if (user && overview) {
    return <RealSkills overview={overview} />;
  }

  // Defense in depth (spec part 9): a signed-in learner whose path will
  // not load must never fall through to the sample map.
  if (user) {
    return <main className="container">
      <PageHeader eyebrow="Knowledge map · Connected concepts" title="Skill map" description="See the prerequisites behind your progress. Each node makes the next useful action easier to choose." />
      <NoLearningPath icon={MapIcon} eyebrow="YOUR SKILL MAP IS WAITING" title="No skills mapped yet." description="Your skill map connects concepts to your goal, one node at a time. Create a learning path and your first nodes appear here." />
      {user.onboardingTopic ? <LearningResources query={user.onboardingTopic} /> : null}
    </main>;
  }

  // Anonymous demo mode: the original sample map (frozen experience).
  return <DemoSkills />;
}

/** The real skill map: one node per persisted lesson, real mastery. */
function RealSkills({ overview }: { overview: LearningPathOverview }) {
  const { lessons, nextLessonId, completedLessonCount } = overview;
  const total = lessons.length;
  const percent = total > 0 ? Math.round((completedLessonCount / total) * 100) : 0;
  const nextLesson = lessons.find((lesson) => lesson.id === nextLessonId) ?? null;
  const remaining = total - completedLessonCount;

  // One map node per persisted lesson, in the AI-recommended order.
  const nodes = lessons.map((lesson) => {
    const done = lesson.completed_at != null;
    const isNext = lesson.id === nextLessonId;
    return {
      id: lesson.id,
      name: lesson.skill.trim() || lesson.title,
      detail: lesson.concepts[0] ?? lesson.topic,
      state: done ? "done" : isNext ? "active" : "locked",
    };
  });

  // Mastery per skill, computed only from real completions.
  const bySkill = new Map<string, { total: number; done: number }>();
  for (const lesson of lessons) {
    const key = lesson.skill.trim() || "General";
    const entry = bySkill.get(key) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (lesson.completed_at != null) entry.done += 1;
    bySkill.set(key, entry);
  }
  const mastery = Array.from(bySkill.entries()).map(([name, counts]) => ({
    name,
    progress: Math.round((counts.done / counts.total) * 100),
    detail: `${counts.done} of ${counts.total} lessons complete`,
  }));

  const focus = nextLesson ?? lessons[lessons.length - 1] ?? null;

  return <main className="container">
    <PageHeader eyebrow="Knowledge map · Connected concepts" title="Skill map" description="See the prerequisites behind your progress. Each node makes the next useful action easier to choose." />

    {total === 0 ? <section className="card pad">
      <div className="eyebrow">YOUR MAP</div>
      <p className="muted" style={{ marginTop: 10 }}>Your lessons are still being prepared. Refresh in a moment and your first nodes appear here.</p>
    </section> : <>
      <section className="card pad concept-map" aria-label="Connected learning path">
        <div className="concept-path">
          {nodes.map((node, index) => <div className="concept-node-wrap" key={node.id}>
            <div className={`concept-node ${node.state}`}>
              <span className="concept-status">{node.state === "done" ? <Check size={13} /> : node.state === "locked" ? <LockKeyhole size={13} /> : index + 1}</span>
              <strong>{node.name}</strong>
              <small>{node.detail}</small>
            </div>
            {index < nodes.length - 1 && <ArrowDown className="concept-arrow" size={17} />}
          </div>)}
        </div>
        <div className="concept-legend">
          <span><i className="legend-dot done" />Mastered</span>
          <span><i className="legend-dot active" />In progress</span>
          <span><i className="legend-dot locked" />Prerequisite ahead</span>
        </div>
      </section>

      <div className="grid grid-2 section">
        <section className="card pad">
          <div className="eyebrow">SKILL MASTERY</div>
          <h2 style={{ marginTop: 8 }}>What you understand</h2>
          <div className="list" style={{ marginTop: 15 }}>
            {mastery.map((skill) => <div className="list-row" key={skill.name}>
              <div>
                <strong style={{ fontSize: 13 }}>{skill.name}</strong>
                <p className="muted" style={{ fontSize: 10, marginTop: 4 }}>{skill.detail}</p>
              </div>
              <span className="mono" style={{ fontSize: 11 }}>{skill.progress}%</span>
            </div>)}
          </div>
        </section>
        <section className="card pad" style={{ background: "var(--lime)" }}>
          <div className="eyebrow">NEXT PREREQUISITE</div>
          <h2 style={{ marginTop: 8 }}>{nextLesson ? nextLesson.title : "Path complete"}</h2>
          <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 13, maxWidth: 340 }}>
            {nextLesson
              ? nextLesson.goal_relevance || nextLesson.objective
              : "You have completed every lesson on this path. Create a new path to keep going."}
          </p>
          <div style={{ marginTop: 28, fontSize: 12 }}>
            {remaining > 0 ? `${remaining} lesson${remaining === 1 ? "" : "s"} remaining` : "Every lesson complete"}
          </div>
          <div className="progress" style={{ marginTop: 9, background: "rgba(16,33,27,.14)" }}><span style={{ width: `${percent}%` }} /></div>
        </section>
      </div>
    </>}

    {focus ? <LearningResources
      query={focus.search_queries[0] ?? focus.title}
      topic={focus.topic}
      skill={focus.skill || undefined}
      level={isLessonLevel(focus.level) ? focus.level : undefined}
    /> : null}
  </main>;
}

/** Anonymous demo mode only: the frozen sample map. */
function DemoSkills() {
  return <main className="container">
    <PageHeader eyebrow="Knowledge map · Connected concepts" title="Skill map" description="See the prerequisites behind your progress. Each node makes the next useful action easier to choose." />
    <section className="card pad concept-map" aria-label="Sample learning path">
      <div className="concept-path">
        {sampleNodes.map((node, index) => <div className="concept-node-wrap" key={node.name}>
          <div className={`concept-node ${node.state}`}>
            <span className="concept-status">{node.state === "done" ? <Check size={13} /> : node.state === "locked" ? <LockKeyhole size={13} /> : index + 1}</span>
            <strong>{node.name}</strong>
            <small>{node.detail}</small>
          </div>
          {index < sampleNodes.length - 1 && <ArrowDown className="concept-arrow" size={17} />}
        </div>)}
      </div>
      <div className="concept-legend">
        <span><i className="legend-dot done" />Mastered</span>
        <span><i className="legend-dot active" />In progress</span>
        <span><i className="legend-dot locked" />Prerequisite ahead</span>
      </div>
    </section>
    <div className="grid grid-2 section">
      <section className="card pad">
        <div className="eyebrow">SKILL MASTERY</div>
        <h2 style={{ marginTop: 8 }}>What you understand</h2>
        <div className="list" style={{ marginTop: 15 }}>
          {sampleSkills.map((skill) => <div className="list-row" key={skill.name}>
            <div><strong style={{ fontSize: 13 }}>{skill.name}</strong><p className="muted" style={{ fontSize: 10, marginTop: 4 }}>{skill.detail}</p></div>
            <span className="mono" style={{ fontSize: 11 }}>{skill.progress}%</span>
          </div>)}
        </div>
      </section>
      <section className="card pad" style={{ background: "var(--lime)" }}>
        <div className="eyebrow">NEXT PREREQUISITE</div>
        <h2 style={{ marginTop: 8 }}>Make REST feel obvious</h2>
        <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 13, maxWidth: 340 }}>Finish this concept and Authentication becomes the next connected node on your path.</p>
        <div style={{ marginTop: 28, fontSize: 12 }}>2 concepts remaining</div>
        <div className="progress" style={{ marginTop: 9, background: "rgba(16,33,27,.14)" }}><span style={{ width: "38%" }} /></div>
      </section>
    </div>
  </main>;
}
