"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Dumbbell, FolderKanban, Map, Target } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Greeting, Today } from "@/components/today";
import { useCurrentUser, useUserState } from "@/components/user-state-provider";

const pathSteps = [
  { icon: Target, name: "Goal", description: "Set what you want to achieve. One clear sentence is enough." },
  { icon: Map, name: "Skills", description: "Your goal breaks down into the specific skills that make it real." },
  { icon: BookOpen, name: "Lessons", description: "Short, focused lessons teach each skill one idea at a time." },
  { icon: Dumbbell, name: "Practice", description: "Challenges and sprints turn understanding into ability." },
  { icon: FolderKanban, name: "Projects", description: "Real builds prove your skills — to the world and to yourself." },
];

function PathExplainer({ tag }: { tag: string }) {
  return <section className="section" aria-labelledby="path-explainer-title">
    <div className="section-head">
      <div>
        <div className="eyebrow">HOW IT WORKS</div>
        <h2 id="path-explainer-title" style={{ marginTop: 7 }}>Your path, in five stages.</h2>
      </div>
      <span className="tag">{tag}</span>
    </div>
    <ol className="path-explainer">
      {pathSteps.map(({ icon: Icon, name, description }, index) => <li className="path-step" key={name}>
        <span className="path-step-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.8} /></span>
        <div>
          <div className="path-step-head"><span className="mono muted">{String(index + 1).padStart(2, "0")}</span><strong>{name}</strong></div>
          <p className="muted">{description}</p>
        </div>
      </li>)}
    </ol>
  </section>;
}

function NewUserDashboard({ name }: { name?: string | null }) {
  return <main className="container">
    <PageHeader eyebrow={<><Today /> · Your learning space</>} title={<Greeting name={name ? <span style={{ color: "var(--orange)" }}>{name}</span> : undefined} />} description="LearningOS is ready when you are. Everything here starts with a learning path." />

    <section className="dashboard-next" aria-labelledby="welcome-title">
      <div className="dashboard-next-copy">
        <div className="eyebrow" style={{ color: "var(--lime)" }}>GETTING STARTED</div>
        <h2 id="welcome-title">Welcome to LearningOS.</h2>
        <p>{"You haven't created a learning path yet. Your path is the backbone of everything here — lessons, practice, and projects all grow from it."}</p>
      </div>
      <div className="dashboard-next-action"><span className="tag">About 2 minutes</span><Link href="/onboarding" className="btn btn-primary">Create your learning path <ArrowRight size={15} /></Link></div>
    </section>

    <PathExplainer tag="Goal → Skills → Lessons → Practice → Projects" />
  </main>;
}

function OnboardedDashboard({ name, topic, hasPath }: { name: string | null; topic: string | null; hasPath: boolean }) {
  return <main className="container">
    <PageHeader eyebrow={<><Today /> · Your learning space</>} title={<Greeting name={name ? <span style={{ color: "var(--orange)" }}>{name}</span> : undefined} />} description="Your learning profile is saved to your account. Everything ahead grows from it." />

    <section className="dashboard-next" aria-labelledby="profile-ready-title">
      {hasPath ? <>
        <div className="dashboard-next-copy">
          <div className="eyebrow" style={{ color: "var(--lime)" }}>PATH READY</div>
          <h2 id="profile-ready-title">Your learning path is live.</h2>
          <p>{topic ? <>You told us: <strong>{topic}</strong>. Your personalized lessons and their videos are ready — pick up where you left off on your journey.</> : "Your personalized lessons and their videos are ready — pick up where you left off on your journey."}</p>
        </div>
        <div className="dashboard-next-action"><span className="tag">Saved to your account</span><div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}><Link href="/journey" className="btn btn-primary">Continue your journey <ArrowRight size={15} /></Link><Link href="/paths" className="btn btn-ghost">My learning paths</Link></div></div>
      </> : <>
        <div className="dashboard-next-copy">
          <div className="eyebrow" style={{ color: "var(--lime)" }}>PROFILE READY</div>
          <h2 id="profile-ready-title">Your learning profile is ready.</h2>
          <p>{topic ? <>You told us: <strong>{topic}</strong>. Your direction, level, and time commitment are saved to your account — the next step is turning them into your personalized lessons.</> : "Your direction, level, and time commitment are saved to your account. The next step is turning them into your personalized lessons."}</p>
        </div>
        <div className="dashboard-next-action"><span className="tag">About a minute</span><Link href="/onboarding" className="btn btn-primary">Build my learning path <ArrowRight size={15} /></Link></div>
      </>}
    </section>

    {hasPath ? <PathExplainer tag="Lessons ready · Practice next" /> : <PathExplainer tag="Goal saved · Skills next" />}
  </main>;
}

export default function DashboardPage() {
  const user = useCurrentUser();
  const state = useUserState();
  if (!user) {
    // Middleware routes unauthenticated visitors to /login; honest fallback.
    return <NewUserDashboard />;
  }
  const firstName = user.fullName?.trim().split(/\s+/)[0] ?? null;
  return user.onboardingComplete
    ? <OnboardedDashboard name={firstName} topic={user.onboardingTopic} hasPath={state.hasLearningPath} />
    : <NewUserDashboard name={firstName} />;
}
