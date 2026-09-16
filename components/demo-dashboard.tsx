"use client";

import Link from "next/link";
import { ArrowRight, Check, Clock3, Code2, LockKeyhole, Sparkles, Target } from "lucide-react";
import { ArrowLink, PageHeader } from "@/components/app-shell";
import { Greeting, Today } from "@/components/today";

function ProgressBar({ value }: { value: number }) { return <div className="progress"><span style={{ width: `${value}%` }} /></div>; }

// Frozen sample values for the public /demo preview only (spec part 2).
// Demo mode is a deliberate anonymous-preview feature, so its samples live
// inline here - there is no shared mock-data module for real pages to
// accidentally import. Only the values this preview renders are kept.
const currentGoal = { title: "Become a Full-Stack Developer", stage: "Stage 2 of 6 · Building fluency", progress: 38, milestone: "Build your first API" };
const todayMission = { title: "Build your first API", description: "One session moves your roadmap forward: learn the concept, practice it in a challenge, then prove it in your project milestone.", steps: ["Learn", "Practice", "Prove"] };
const nextMove = { title: "Understand REST API methods", reason: "Required before your next project.", time: "12 min", skill: "Backend fundamentals" };
const skills = [
  { name: "HTML & CSS", progress: 100, state: "done", detail: "12 concepts mastered" },
  { name: "JavaScript", progress: 72, state: "active", detail: "9 of 14 concepts" },
  { name: "Async JavaScript", progress: 31, state: "active", detail: "Worth another pass" },
  { name: "React", progress: 0, state: "locked", detail: "Complete prerequisites" },
];
const lessons = [
  { id: "async-await", title: "JavaScript Async/Await", concept: "Async JavaScript", duration: "18 min left", progress: 64, type: "Deep learn" },
];
const projects = [
  { title: "Real-Time Weather Dashboard", description: "Build a weather interface that fetches, transforms, and renders live data." },
];

/**
 * The sample-data dashboard used by the public /demo preview. It renders the
 * same Phase 1 interface filled entirely with mock data — clearly labeled,
 * shown only on the demo page, and never mixed into the authenticated app.
 */
export function DemoDashboard() {
  return <main className="container" aria-label="Demo preview with sample data">
    <PageHeader eyebrow={<><Today /> · Demo preview</>} title={<Greeting />} description="This is what LearningOS looks like with a learning path in motion. Everything on this page is sample data." />

    <section className="dashboard-next" aria-labelledby="demo-mission-title">
      <div className="dashboard-next-copy"><div className="eyebrow" style={{ color: "var(--lime)" }}>WHAT TO DO NOW</div><h2 id="demo-mission-title">{todayMission.title}</h2><p>{todayMission.description}</p><div className="dashboard-loop">{todayMission.steps.map((step, index) => <span key={step}><b>{String(index + 1).padStart(2, "0")}</b>{step}</span>)}</div></div>
      <div className="dashboard-next-action"><span className="tag">15 min · Intermediate</span><Link href="/signup" className="btn btn-primary">Start for real <ArrowRight size={15} /></Link></div>
    </section>

    <section className="section dashboard-goal-row"><div><div className="eyebrow">CURRENT GOAL</div><h2 style={{ marginTop: 8 }}>{currentGoal.title}</h2><p className="muted" style={{ marginTop: 7, fontSize: 12 }}>{currentGoal.stage} · {currentGoal.milestone}</p></div><div className="goal-progress"><div><span className="mono muted">CAPABILITY</span><strong>{currentGoal.progress}%</strong></div><ProgressBar value={currentGoal.progress} /></div></section>

    <section className="section"><div className="section-head"><div><div className="eyebrow">NEXT BEST MOVE</div><h2 style={{ marginTop: 7 }}>The clearest step forward.</h2></div><span className="tag">Selected for your path</span></div><div className="next-move-panel"><div className="move-icon"><Code2 size={24} /></div><div style={{ flex: 1 }}><h3>{nextMove.title}</h3><p className="muted" style={{ fontSize: 12, marginTop: 5 }}>{nextMove.reason}</p><div className="move-meta"><span><Clock3 size={12} />{nextMove.time}</span><span>{nextMove.skill}</span></div></div><Link href="/signup" className="btn btn-dark">Start learning <ArrowRight size={14} /></Link></div></section>

    <div className="grid grid-2 section">
      <section className="card pad"><div className="section-head"><div><div className="eyebrow">SKILL MASTERY</div><h2 style={{ marginTop: 7 }}>What you understand</h2></div><span className="tag">Sample data</span></div><div className="list">{skills.map(skill => <div className="list-row" key={skill.name}><div style={{ flex: 1 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7, fontSize: 12 }}><strong>{skill.name}</strong>{skill.state === "locked" ? <LockKeyhole size={14} className="muted" /> : <span className="mono muted">{skill.progress}%</span>}</div><ProgressBar value={skill.progress} /><p className="muted" style={{ fontSize: 10, marginTop: 6 }}>{skill.detail}</p></div></div>)}</div></section>
      <section className="card pad"><div className="section-head"><div><div className="eyebrow">CONTINUE LEARNING</div><h2 style={{ marginTop: 7 }}>Pick up where you left off</h2></div><Sparkles size={18} color="var(--orange)" /></div>{lessons.slice(0, 1).map(lesson => <div key={lesson.id} className="continue-panel"><span className="tag">{lesson.type}</span><h3 style={{ marginTop: 15 }}>{lesson.title}</h3><p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{lesson.concept} · {lesson.duration}</p><div style={{ marginTop: 20 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 7 }}><span>Lesson progress</span><strong>{lesson.progress}%</strong></div><ProgressBar value={lesson.progress} /></div><Link className="btn btn-dark" href="/signup" style={{ width: "100%", marginTop: 18 }}>Create your account <ArrowRight size={14} /></Link></div>)}</section>
    </div>

    <div className="grid grid-2 section">
      <section className="card pad"><div className="section-head"><div><div className="eyebrow">WEAK CONCEPTS</div><h2 style={{ marginTop: 7 }}>Worth a short review</h2></div><Target size={19} color="var(--orange)" /></div><p className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>A quick pass now will make your next challenge more useful.</p>{["Promises", "Array methods", "DOM events"].map((item, i) => <div className="list-row" key={item}><span style={{ fontSize: 12 }}>{item}</span><span className="tag" style={{ background: i === 0 ? "var(--peach)" : "var(--mint)", color: i === 0 ? "var(--peach-ink)" : "var(--success-ink)" }}>{i === 0 ? "Review soon" : "Worth a pass"}</span></div>)}</section>
      <section className="card pad"><div className="section-head"><div><div className="eyebrow">UPCOMING PROJECT</div><h2 style={{ marginTop: 7 }}>{projects[0].title}</h2></div><span className="tag">Readiness 72%</span></div><p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>{projects[0].description}</p><div className="readiness-line"><Check size={15} color="var(--orange)" />API basics <Check size={15} color="var(--orange)" />Async JavaScript</div><ArrowLink href="/signup">Start your own path</ArrowLink></section>
    </div>

    <section className="card pad section" style={{ display: "grid", gap: 14 }}>
      <div className="eyebrow">FROM PREVIEW TO REAL</div>
      <h2 style={{ marginTop: 0 }}>Like what you see?</h2>
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.7, maxWidth: 560 }}>Create a free account and build your own learning profile — your topic, level, time, and goal. Your real path grows from there.</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/signup" className="btn btn-primary">Create your account <ArrowRight size={14} /></Link>
        <Link href="/login" className="btn btn-ghost">Sign in</Link>
      </div>
    </section>
  </main>;
}
