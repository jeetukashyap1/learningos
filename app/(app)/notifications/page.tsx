import { Bell, BellOff, Clock3 } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { NoLearningPath } from "@/components/no-learning-path";
import { getCurrentUser, getCurrentUserState } from "@/lib/auth";
import { isLearningPathError, LearningPathError } from "@/lib/learning-path/errors";
import { loadLearningPathOverview, type LearningPathOverview } from "@/lib/learning-path/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Frozen sample notifications for anonymous demo mode only. */
const sampleNotifications = [
  { title: "A project is almost unlocked", detail: "Complete DOM integration to start Weather Dashboard.", time: "12 min ago", kind: "Project", read: false },
  { title: "Revision is due", detail: "A quick pass on Promises will keep your progress moving.", time: "Yesterday", kind: "Revision", read: true },
  { title: "Milestone reached", detail: "You can now explain async functions with confidence.", time: "2 days ago", kind: "Milestone", read: true },
];

/**
 * Real notifications (spec part 2): signals derived from the learner's
 * persisted path - videos still loading, lessons without a strong video,
 * what is up next, and completed-lesson milestones. No mock data reaches
 * a signed-in learner; the frozen sample list remains only for anonymous
 * demo mode, which always has sample data.
 */
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  const state = await getCurrentUserState(user);

  if (!state.hasLearningPath) {
    return <main className="container">
      <PageHeader eyebrow="Signals for your learning path" title="Notifications" description="Small reminders, useful milestones, and the next thing worth your attention." />
      <NoLearningPath icon={BellOff} eyebrow="ALL QUIET" title="No notifications yet." description="When something on your path needs attention — a review due, a milestone reached — it will show up here." />
    </main>;
  }

  // Signed-in path holders get real signals; anonymous demo visitors
  // (state.hasLearningPath via the demo cookie) see the sample list.
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
      <PageHeader eyebrow="Signals for your learning path" title="Notifications" description="Small reminders, useful milestones, and the next thing worth your attention." />
      <EmptyState icon={BellOff} eyebrow="NOTIFICATIONS UNAVAILABLE" title="We could not load your notifications." description={loadError.safeMessage} />
    </main>;
  }

  if (user && overview) {
    return <RealNotifications overview={overview} />;
  }

  // Defense in depth (spec part 9): a signed-in learner whose path will
  // not load must never fall through to the sample list, whatever the
  // flags said. The honest no-path state is the only real-user fallback.
  if (user) {
    return <main className="container">
      <PageHeader eyebrow="Signals for your learning path" title="Notifications" description="Small reminders, useful milestones, and the next thing worth your attention." />
      <NoLearningPath icon={BellOff} eyebrow="ALL QUIET" title="No notifications yet." description="When something on your path needs attention — a review due, a milestone reached — it will show up here." />
    </main>;
  }

  // Anonymous demo mode: the original frozen sample list.
  return <main className="container">
    <PageHeader eyebrow="Signals for your learning path" title="Notifications" description="Small reminders, useful milestones, and the next thing worth your attention." />
    <div className="card pad" style={{ maxWidth: 850 }}>
      {sampleNotifications.map((notification) => (
        <article className="list-row" key={notification.title}>
          <div className="move-icon" style={{ background: notification.read ? "var(--paper)" : "var(--mint)", color: "var(--ink)" }}><Bell size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
              <strong style={{ fontSize: 13 }}>{notification.title}</strong>
              {!notification.read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--orange)" }} />}
            </div>
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 5 }}>{notification.detail}</p>
          </div>
          <span className="mono muted" style={{ fontSize: 10, whiteSpace: "nowrap" }}><Clock3 size={11} /> {notification.time}</span>
        </article>
      ))}
    </div>
  </main>;
}

/** Real signals derived from the learner's active path. */
function RealNotifications({ overview }: { overview: LearningPathOverview }) {
  const { path, lessons, nextLessonId, completedLessonCount } = overview;
  const total = lessons.length;
  const nextLesson = lessons.find((lesson) => lesson.id === nextLessonId) ?? null;
  const pendingVideos = lessons.filter((lesson) => lesson.resource_status === "pending");
  const missingVideos = lessons.filter((lesson) => lesson.resource_status === "unavailable");
  const recentCompletions = lessons
    .filter((lesson) => lesson.completed_at != null)
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    .slice(0, 3);
  const remaining = total - completedLessonCount;

  type Signal = { title: string; detail: string; kind: string; href: string };
  const signals: Signal[] = [];

  if (pendingVideos.length > 0) {
    signals.push({
      title: "Videos still loading",
      detail: `${pendingVideos.length} ${pendingVideos.length === 1 ? "lesson is" : "lessons are"} still waiting for a matched video. They finish loading in the background — you can retry from your journey.`,
      kind: "Videos",
      href: "/journey",
    });
  }
  for (const lesson of missingVideos.slice(0, 2)) {
    signals.push({
      title: "No strong video found yet",
      detail: `We could not find a highly relevant video for “${lesson.title}”. Retry the search from your journey, or open the lesson and learn without one.`,
      kind: "Videos",
      href: "/journey",
    });
  }
  if (nextLesson) {
    signals.push({
      title: "Up next on your path",
      detail: `“${nextLesson.title}” — ${nextLesson.estimated_minutes} min · ${nextLesson.level}${nextLesson.skill ? ` · ${nextLesson.skill}` : ""}.`,
      kind: "Next up",
      href: `/learn/${nextLesson.id}`,
    });
  }
  for (const lesson of recentCompletions) {
    signals.push({
      title: "Lesson complete",
      detail: `“${lesson.title}” is done${remaining > 0 ? ` — ${remaining} ${remaining === 1 ? "lesson" : "lessons"} to go on “${path.title}”` : ""}.`,
      kind: "Milestone",
      href: `/learn/${lesson.id}`,
    });
  }
  if (total > 0 && remaining === 0) {
    signals.push({
      title: "Path complete",
      detail: `You finished every lesson on “${path.title}”. Ready for the next goal? Start a new path from your library.`,
      kind: "Milestone",
      href: "/paths",
    });
  }

  return <main className="container">
    <PageHeader eyebrow="Signals for your learning path" title="Notifications" description={`Honest signals from “${path.title}” — videos loading, what is next, and milestones you have earned.`} />
    {signals.length === 0 ? (
      <EmptyState icon={BellOff} eyebrow="ALL QUIET" title="You're all caught up." description="Nothing on your path needs attention right now. When something does — a video retry, a milestone — it will show up here." actionLabel="Open your journey" actionHref="/journey" />
    ) : (
      <div className="card pad" style={{ maxWidth: 850 }}>
        {signals.map((signal, index) => (
          <article className="list-row" key={`${signal.kind}-${signal.title}-${index}`}>
            <div className="move-icon" style={{ background: "var(--mint)", color: "var(--ink)" }}><Bell size={18} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
                <strong style={{ fontSize: 13 }}>{signal.title}</strong>
                <span className="tag">{signal.kind}</span>
              </div>
              <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 5 }}>{signal.detail}</p>
            </div>
            <Link href={signal.href} className="btn btn-ghost" style={{ fontSize: 11, padding: "8px 12px", flexShrink: 0 }}>Open</Link>
          </article>
        ))}
      </div>
    )}
  </main>;
}
