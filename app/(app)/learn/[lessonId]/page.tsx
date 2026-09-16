import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, BrainCircuit, Clock, Lightbulb, ListChecks, Play, Youtube as YoutubeIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { NoLearningPath } from "@/components/no-learning-path";
import { LearningResources } from "@/components/learning-resources";
import { YouTubeEmbed } from "@/components/youtube-embed";
import { getCurrentUser, isDemoMode } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLearningPathError, LearningPathError } from "@/lib/learning-path/errors";
import { loadLearningPathOverview, type LearningPathOverview, type LearningPathLessonRow } from "@/lib/learning-path/service";
import { DemoLessonView } from "./demo-lesson-view";
import { CompleteLessonButton } from "./complete-lesson-button";

/**
 * The lesson page, from real data (spec part 13): the persisted lesson
 * (title, description, level, minutes, prerequisites), its AI-matched
 * video through the existing YouTubeEmbed, more resources through the
 * existing LearningResources, and completion through the existing
 * completion API. No mock content is shown to a signed-in learner -
 * the frozen sample lesson remains only for anonymous demo mode.
 */
export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  const user = await getCurrentUser();

  // Anonymous visitors: the frozen sample lesson in demo mode, otherwise
  // the same empty state the page has always shown.
  if (!user) {
    if (await isDemoMode(null)) return <DemoLessonView />;
    return <main className="container">
      <Link href="/quick-learn" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
        <ArrowLeft size={15} /> Back to quick learn
      </Link>
      <div style={{ maxWidth: 720, margin: "34px auto 0" }}>
        <NoLearningPath icon={BookOpen} eyebrow="LESSONS LIVE ON YOUR PATH" title="No lesson yet." description="This lesson viewer opens the concepts your path recommends. Create your learning path to start your first one." />
      </div>
    </main>;
  }

  // Signed-in learners: the real, persisted lesson.
  const supabase = await createSupabaseServerClient();
  let overview: LearningPathOverview | null = null;
  let loadError: LearningPathError | null = null;
  try {
    overview = await loadLearningPathOverview(supabase, user.id, { includeResource: true });
  } catch (error) {
    loadError = isLearningPathError(error)
      ? error
      : new LearningPathError("unexpected", "We could not open this lesson right now. Please refresh the page.");
  }

  if (loadError) {
    return <main className="container">
      <Link href="/journey" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
        <ArrowLeft size={15} /> Back to my journey
      </Link>
      <div style={{ maxWidth: 720, margin: "34px auto 0" }}>
        <EmptyState icon={BookOpen} eyebrow="LESSON UNAVAILABLE" title="We could not open this lesson." description={loadError.safeMessage} />
      </div>
    </main>;
  }

  if (!overview) {
    return <main className="container">
      <Link href="/dashboard" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
        <ArrowLeft size={15} /> Back to dashboard
      </Link>
      <div style={{ maxWidth: 720, margin: "34px auto 0" }}>
        <NoLearningPath icon={BookOpen} eyebrow="LESSONS LIVE ON YOUR PATH" title="No lesson yet." description="This lesson viewer opens the concepts your path recommends. Create your learning path to start your first one." />
      </div>
    </main>;
  }

  const lesson = overview.lessons.find((item) => item.id === lessonId) ?? null;
  if (!lesson) {
    return <main className="container">
      <Link href="/journey" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
        <ArrowLeft size={15} /> Back to my journey
      </Link>
      <div style={{ maxWidth: 720, margin: "34px auto 0" }}>
        <EmptyState icon={BookOpen} eyebrow="NOT ON YOUR PATH" title="We could not find that lesson." description="It may belong to an older path, or the link is out of date. Your journey lists every lesson on your current path." actionLabel="Go to my journey" actionHref="/journey" />
      </div>
    </main>;
  }

  return <RealLessonView overview={overview} lesson={lesson} />;
}

/** The real lesson: persisted content, its module context, its matched video, more resources, real completion. */
function RealLessonView({ overview, lesson }: { overview: LearningPathOverview; lesson: LearningPathLessonRow }) {
  const total = overview.lessons.length;
  const done = lesson.completed_at != null;
  const resource = overview.resourceById.get(lesson.id) ?? null;
  const nextLesson = overview.lessons.find((item) => item.lesson_order === lesson.lesson_order + 1) ?? null;
  const prevLesson = overview.lessons.find((item) => item.lesson_order === lesson.lesson_order - 1) ?? null;
  const lessonModule = lesson.module_id ? overview.modules.find((item) => item.id === lesson.module_id) ?? null : null;
  const lessonInModule = lessonModule ? lessonModule.lessons.findIndex((item) => item.id === lesson.id) + 1 : 0;
  const level = isLessonLevel(lesson.level) ? lesson.level : undefined;
  const query = lesson.search_queries[0] ?? lesson.title;

  return (
    <main className="container">
      <Link href="/journey" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
        <ArrowLeft size={15} /> Back to my journey
      </Link>

      <div style={{ maxWidth: 980, margin: "30px auto 0" }}>
        <div className="section-head" style={{ alignItems: "start" }}>
          <div>
            <div className="eyebrow">
              {lessonModule ? `MODULE ${lessonModule.orderIndex} · LESSON ${lessonInModule} OF ${lessonModule.lessons.length}` : `LESSON ${lesson.lesson_order} OF ${total}`} · {lesson.estimated_minutes} MIN · {lesson.level}
            </div>
            <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", marginTop: 12 }}>{lesson.title}</h1>
            {lessonModule && <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>Module {lessonModule.orderIndex}: {lessonModule.title}</p>}
            <p className="muted" style={{ maxWidth: 600, marginTop: 14, lineHeight: 1.7 }}>{lesson.description}</p>
          </div>
          {lesson.skill ? <span className="tag">{lesson.skill}</span> : null}
        </div>

        {lesson.prerequisites.length > 0 && (
          <section className="card pad" style={{ marginTop: 28, display: "flex", gap: 12, alignItems: "flex-start" }}>
            <ListChecks size={17} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
            <div>
              <div className="eyebrow">BEFORE YOU START</div>
              <p className="muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.7 }}>{lesson.prerequisites.join(" · ")}</p>
            </div>
          </section>
        )}

        <section style={{ marginTop: 28 }}>
          <div className="eyebrow" style={{ marginBottom: 12 }}>YOUR VIDEO FOR THIS LESSON</div>
          {resource && resource.externalId ? (
            <div style={{ display: "grid", gap: 10 }}>
              <YouTubeEmbed videoId={resource.externalId} title={resource.title} />
              {resource.url && (
                <a className="btn btn-ghost" href={resource.url} target="_blank" rel="noopener noreferrer" style={{ justifySelf: "start" }}>
                  <YoutubeIcon size={14} /> Open on YouTube
                </a>
              )}
            </div>
          ) : lesson.resource_status === "pending" ? (
            <div className="card pad" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Clock size={15} aria-hidden="true" style={{ marginTop: 2, flexShrink: 0 }} />
              <p className="muted" style={{ fontSize: 13 }}>
                Your video for this lesson is still being matched. It finishes loading in the background — you can retry from your journey, or explore the extra resources below.
              </p>
            </div>
          ) : (
            <div className="card pad" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Lightbulb size={15} aria-hidden="true" style={{ marginTop: 2, flexShrink: 0 }} />
              <p className="muted" style={{ fontSize: 13 }}>
                No video matched this lesson yet. The extra resources below can fill the gap — your path continues either way.
              </p>
            </div>
          )}
        </section>

        <div className="section">
          <LearningResources query={query} topic={lesson.topic} skill={lesson.skill || undefined} level={level} />
        </div>

        <div className="card pad section" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div className="eyebrow">YOUR PROGRESS</div>
            <h3 style={{ marginTop: 8 }}>{done ? "Lesson complete — nicely done." : "Finish the video, then mark it done."}</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {overview.completedLessonCount} of {total} lessons on “{overview.path.title}” complete.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "end" }}>
            {/* Spec §11: the lesson-level tutor entry. Only the lesson id travels in
                the URL - the server re-verifies it belongs to this learner's own
                active path before any context is used (never trusted from the client). */}
            <Link href={`/ai-tutor?lesson=${lesson.id}`} className="btn btn-ghost">
              <BrainCircuit size={14} /> Ask AI Tutor
            </Link>
            <CompleteLessonButton lessonId={lesson.id} completed={done} />
            {prevLesson && (
              <Link href={`/learn/${prevLesson.id}`} className="btn btn-ghost">
                <ArrowLeft size={14} /> Previous lesson
              </Link>
            )}
            {nextLesson && (
              <Link href={`/learn/${nextLesson.id}`} className="btn btn-ghost">
                Next lesson <ArrowRight size={14} />
              </Link>
            )}
          </div>
        </div>

        {nextLesson ? (
          <p className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Play size={13} aria-hidden="true" /> Next up: {nextLesson.title}
          </p>
        ) : overview.finalOutcome.kind !== "" ? (
          <p className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Play size={13} aria-hidden="true" /> That was the last lesson — next up is your final outcome: <Link href="/projects" style={{ textDecoration: "underline" }}>{overview.finalOutcome.title}</Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}

function isLessonLevel(value: string): value is "beginner" | "intermediate" | "advanced" {
  return value === "beginner" || value === "intermediate" || value === "advanced";
}
