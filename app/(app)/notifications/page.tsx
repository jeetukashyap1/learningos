import { Bell, BellOff, Clock3 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { NoLearningPath } from "@/components/no-learning-path";
import { getCurrentUser, getCurrentUserState } from "@/lib/auth";
import { isLearningPathError, LearningPathError } from "@/lib/learning-path/errors";
import { loadLearningPathOverview, type LearningPathOverview } from "@/lib/learning-path/service";
import { isNotificationError } from "@/lib/notifications/errors";
import { buildNotificationSignals, countUnreadSignals, loadNotificationReadKeys, NO_READ_KEYS } from "@/lib/notifications/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NotificationRow } from "./notification-row";

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
  // Read state is loaded from the persisted notification_reads table only
  // once the path itself loaded - it is the user's own row set (RLS scoped).
  let overview: LearningPathOverview | null = null;
  let readKeys: ReadonlySet<string> = NO_READ_KEYS;
  let loadError: LearningPathError | null = null;
  if (user) {
    const supabase = await createSupabaseServerClient();
    try {
      overview = await loadLearningPathOverview(supabase, user.id);
      if (overview) readKeys = await loadNotificationReadKeys(supabase, user.id);
    } catch (error) {
      if (isLearningPathError(error)) loadError = error;
      else if (isNotificationError(error)) loadError = new LearningPathError("persistence", error.safeMessage);
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
    return <RealNotifications overview={overview} readKeys={readKeys} />;
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

/**
 * Real signals derived from the learner's active path. The signals (and
 * their stable keys) come from lib/notifications/service.ts so identity
 * never depends on render order; read/unread comes purely from the
 * persisted notification_reads row set. A new signal has no row and is
 * therefore unread; opening it writes a row and it stays read.
 */
function RealNotifications({ overview, readKeys }: { overview: LearningPathOverview; readKeys: ReadonlySet<string> }) {
  const { path } = overview;
  const signals = buildNotificationSignals(overview);
  const unread = countUnreadSignals(signals, readKeys);

  return <main className="container">
    <PageHeader
      eyebrow="Signals for your learning path"
      title="Notifications"
      description={unread > 0
        ? `${unread} unread ${unread === 1 ? "signal" : "signals"} from “${path.title}” — videos loading, what is next, and milestones you have earned.`
        : `You are up to date on “${path.title}”. New signals will appear here as your path moves.`}
    />
    {signals.length === 0 ? (
      <EmptyState icon={BellOff} eyebrow="ALL QUIET" title="You're all caught up." description="Nothing on your path needs attention right now. When something does — a video retry, a milestone — it will show up here." actionLabel="Open your journey" actionHref="/journey" />
    ) : (
      <div className="card pad" style={{ maxWidth: 850 }}>
        {signals.map((signal) => (
          <NotificationRow
            key={signal.key}
            signalKey={signal.key}
            title={signal.title}
            detail={signal.detail}
            kind={signal.kind}
            href={signal.href}
            read={readKeys.has(signal.key)}
          />
        ))}
      </div>
    )}
  </main>;
}
