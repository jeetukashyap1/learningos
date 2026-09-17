"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, CircleHelp, Lightbulb, Play, Sparkles, Volume2 } from "lucide-react";
import { LearningResources } from "@/components/learning-resources";
import { useState } from "react";

// Frozen sample lessons for anonymous demo mode only (spec part 2): the
// demo preview is a deliberate feature, so its two sample lessons live
// inline here - never in a shared mock-data module that real pages could
// accidentally import.
const lessons = [
  { id: "async-await", title: "JavaScript Async/Await", concept: "Async JavaScript", duration: "18 min left", progress: 64, type: "Deep learn", description: "Make asynchronous code easier to read, reason about, and debug." },
  { id: "rest-methods", title: "Understand REST API methods", concept: "Backend fundamentals", duration: "12 min", progress: 0, type: "Quick learn", description: "See how GET, POST, PATCH, and DELETE map to real product actions." },
];

/**
 * Frozen sample lesson view for anonymous demo mode only (the visitor is
 * not signed in and the demo cookie is on). Signed-in learners never see
 * this - the server page renders their real, persisted lesson instead
 * (spec parts 3, 13). Kept byte-for-byte close to the original page.
 */
export function DemoLessonView() {
  const params = useParams<{ lessonId: string }>();
  const [selected, setSelected] = useState<string | null>(null);
  const [continued, setContinued] = useState(false);
  const isCorrect = selected === "PATCH";

  const lesson = lessons.find((item) => item.id === params.lessonId) ?? lessons[1];

  return (
    <main className="container">
      <Link href="/quick-learn" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
        <ArrowLeft size={15} /> Back to quick learn
      </Link>

      <div style={{ maxWidth: 980, margin: "30px auto 0" }}>
        <div className="section-head" style={{ alignItems: "start" }}>
          <div>
            <div className="eyebrow">{lesson.type} · {lesson.duration}</div>
            <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", marginTop: 12 }}>{lesson.title}</h1>
            <p className="muted" style={{ maxWidth: 600, marginTop: 14, lineHeight: 1.7 }}>{lesson.description}</p>
          </div>
          <span className="tag">{lesson.concept}</span>
        </div>

        <div className="card mission" style={{ marginTop: 28, minHeight: 390 }}>
          <div className="eyebrow" style={{ color: "var(--lime)" }}>CONCEPT IN CONTEXT · 04:32</div>
          <div style={{ maxWidth: 620, position: "relative", zIndex: 1 }}>
            <h2>REST methods are verbs for changing a product.</h2>
            <p style={{ color: "#c5d0cc", lineHeight: 1.7, maxWidth: 560 }}>
              An API request becomes easier to reason about when the method matches the intent. Read this example, then predict what should happen next.
            </p>
          </div>
          <div className="card mission-preview" style={{ position: "absolute", right: "8%", bottom: 28, zIndex: 2, padding: 18, color: "var(--ink)", width: "min(310px, 62%)", boxShadow: "0 20px 35px rgba(0,0,0,.18)" }}>
            <div className="mono muted" style={{ fontSize: 10 }}>REQUEST PREVIEW</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 13 }}><Play size={15} fill="currentColor" /><strong>PATCH /profile</strong></div>
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>Update only the fields that changed.</p>
          </div>
        </div>

        <div className="section grid grid-2">
          <section className="card pad">
            <div className="eyebrow">WATCH → THINK → PREDICT</div>
            <h2 style={{ marginTop: 10 }}>What should the server do?</h2>
            <p className="muted" style={{ lineHeight: 1.6, marginTop: 10 }}>A user edits their profile bio. Choose the method that communicates a partial update.</p>
            <div style={{ display: "grid", gap: 9, marginTop: 20 }}>
              {["GET", "POST", "PATCH", "DELETE"].map((option) => {
                const active = selected === option;
                return <button type="button" key={option} onClick={() => setSelected(option)} aria-pressed={active} className="btn btn-ghost" style={{ justifyContent: "space-between", border: `1px solid ${active ? (option === "PATCH" ? "#70a33f" : "var(--orange)") : "var(--line)"}`, background: active ? (option === "PATCH" ? "var(--mint)" : "var(--peach)") : "var(--paper)" }}><span><span className="mono" style={{ marginRight: 12 }}>{option}</span>{option === "PATCH" ? "Change part of a resource" : "Request action"}</span>{active && <Check size={15} />}</button>;
              })}
            </div>
            {selected && <div role="status" style={{ marginTop: 16, padding: 14, borderRadius: 12, background: isCorrect ? "var(--mint)" : "var(--peach)", fontSize: 12, lineHeight: 1.5 }}>{isCorrect ? "Nice call. PATCH is precise because the bio is only one part of the profile." : "Almost. Think about whether you are reading, creating, replacing, or removing a resource."}</div>}
          </section>

          <aside style={{ display: "grid", gap: 18, alignContent: "start" }}>
            <div className="card pad lime-surface">
              <Lightbulb size={19} />
              <h3 style={{ marginTop: 15 }}>Key ideas</h3>
              <ul className="muted" style={{ paddingLeft: 18, lineHeight: 1.9, fontSize: 13, margin: "10px 0 0" }}><li>GET reads a resource.</li><li>POST creates something new.</li><li>PATCH updates part of something.</li></ul>
            </div>
            <div className="card pad">
              <div style={{ display: "flex", gap: 10, alignItems: "start" }}><CircleHelp size={18} /><div><h3>Choose your next explanation</h3><p className="muted" style={{ lineHeight: 1.5, fontSize: 12, marginTop: 7 }}>Use a different lens if the first explanation has not clicked yet.</p></div></div>
              <div className="lesson-tools"><button type="button" className="btn btn-ghost"><Sparkles size={14} />Explain simpler</button><button type="button" className="btn btn-ghost">Show an example</button><button type="button" className="btn btn-ghost">Show visually</button><button type="button" className="btn btn-ghost">Smaller challenge</button></div>
            </div>
          </aside>
        </div>

        <LearningResources query={lesson.title} topic={lesson.concept} level="intermediate" />

        <div className="card pad section" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}><div className="eyebrow">YOUR PROGRESS</div><h3 style={{ marginTop: 8 }}>{continued ? "Concept added to your path" : "One clear idea is enough for now."}</h3><div className="progress" style={{ marginTop: 14, width: "100%", maxWidth: 270 }}><span style={{ width: continued ? "100%" : `${lesson.progress}%` }} /></div></div>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}><button type="button" className="btn btn-ghost"><Volume2 size={14} />Read aloud</button><button type="button" className="btn btn-primary" onClick={() => setContinued(true)}>Continue <ArrowRight size={14} /></button></div>
        </div>
      </div>
    </main>
  );
}
