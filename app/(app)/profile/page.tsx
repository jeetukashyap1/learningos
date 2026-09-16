import Link from "next/link";
import { Award, BookOpen, Check, CircleUserRound, Settings, Target } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/app-shell";
import { ProfileDetailsForm } from "./profile-details-form";
import { getCurrentUser, getCurrentUserState } from "@/lib/auth";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  const state = await getCurrentUserState(user);
  if (!user) {
    // Route protection normally prevents this; render honest fallback.
    return <main className="container">
      <PageHeader eyebrow="Your learning identity" title="Your profile" description="A calm view of the direction you are building toward, the skills you have earned, and the work still ahead." action={<Link href="/login?next=/profile" className="btn btn-ghost"><CircleUserRound size={14} />Sign in</Link>} />
      <EmptyState icon={CircleUserRound} eyebrow="YOUR PROFILE GROWS WITH YOU" title="Nothing to show yet." description="Sign in to see your learning profile. Your goal, focus, and milestones appear here as you learn." actionLabel="Sign in" actionHref="/login?next=/profile" />
    </main>;
  }
  const displayName = user.fullName ?? "New learner";
  const initial = displayName.trim().charAt(0).toUpperCase() || "L";
  const joined = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;
  return <main className="container">
    <PageHeader eyebrow="Your learning identity" title={displayName} description="A calm view of the direction you are building toward, the skills you have earned, and the work still ahead." action={<Link href="/settings" className="btn btn-ghost"><Settings size={14} />Edit profile</Link>} />
    <div className="hero-grid" style={{ marginTop: 28 }}>
      <section className="card pad" style={{ background: "var(--navy)", color: "white" }}>
        <div className="avatar" style={{ width: 64, height: 64, fontSize: 20 }}>{initial}</div>
        <h2 style={{ marginTop: 24 }}>{displayName}</h2>
        <p style={{ color: "#c5d0cc", fontSize: 13, lineHeight: 1.6, marginTop: 9, wordBreak: "break-all" }}>{user.email}</p>
        <p style={{ color: "#c5d0cc", fontSize: 13, lineHeight: 1.6, marginTop: 9 }}>{joined ? `Learning with intent since ${joined}.` : "Your learning story starts now."}</p>
        <div className="stat-row" style={{ marginTop: 30 }}>
          <div className="stat"><strong>{user.emailConfirmed ? "Verified" : "Pending"}</strong><span style={{ color: "#a8b8b0", fontSize: 11 }}>email status</span></div>
          <div className="stat"><strong>{user.onboardingComplete ? "Complete" : "Not started"}</strong><span style={{ color: "#a8b8b0", fontSize: 11 }}>learning profile</span></div>
        </div>
      </section>
      <section className="card pad">
        <div className="eyebrow">LEARNING SNAPSHOT</div>
        {[
          { icon: Target, label: "Current focus", value: state.hasLearningPath ? "Your saved learning topic" : "Nothing yet — set your direction first" },
          { icon: BookOpen, label: "Recent win", value: state.hasLearningPath ? "First wins arrive with your first lessons" : "No lessons completed yet" },
          { icon: Award, label: "Next milestone", value: state.hasLearningPath ? "Your first project build" : "Create your learning path" },
        ].map(({ icon: Icon, label, value }) => <div className="list-row" key={label}><Icon size={17} color="var(--orange)" /><div style={{ flex: 1 }}><div className="muted" style={{ fontSize: 10 }}>{label}</div><strong style={{ fontSize: 13 }}>{value}</strong></div><Check size={15} color={state.hasLearningPath ? "#5d963f" : "var(--line)"} /></div>)}
      </section>
    </div>
    <ProfileDetailsForm initialName={user.fullName} email={user.email} />
  </main>;
}
