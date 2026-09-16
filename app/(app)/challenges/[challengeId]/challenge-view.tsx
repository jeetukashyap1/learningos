"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CircleHelp, RotateCcw, Target } from "lucide-react";

/**
 * Serializable challenge shape passed from the server page: everything
 * comes from the persisted lesson (practice concept, objective,
 * concepts) - there is no hardcoded answer key (spec part 19).
 */
export interface ChallengeData {
  id: string;
  title: string;
  prompt: string;
  objective: string;
  concepts: string[];
  skill: string;
  level: string;
  lessonHref: string;
}

export function ChallengeView({ challenge }: { challenge: ChallengeData }) {
  const [revealed, setRevealed] = useState(false);

  return <div style={{ maxWidth: 760, margin: "34px auto 0" }}>
    <div className="eyebrow">WHAT WOULD YOU DO? · {challenge.level} · {challenge.skill}</div>
    <h1 style={{ marginTop: 12 }}>{challenge.title}</h1>
    <p className="muted" style={{ lineHeight: 1.7, marginTop: 16 }}>A real situation from your path, one careful decision. Your answer helps you choose what to reinforce next.</p>

    <section className="card pad" style={{ marginTop: 30 }}>
      <div className="move-icon" style={{ background: "var(--mint)", color: "var(--ink)" }}><Target size={22} /></div>
      <h2 style={{ marginTop: 22 }}>{challenge.prompt}</h2>
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginTop: 14 }}>Work it out loud or on paper first - no options, no guessing. Then compare your answer with the reference approach.</p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 26, gap: 12, flexWrap: "wrap" }}>
        <span className="muted" style={{ fontSize: 12 }}>No penalty for thinking it through.</span>
        <button type="button" className="btn btn-dark" onClick={() => setRevealed(true)} disabled={revealed} style={{ opacity: revealed ? 0.5 : 1 }}>
          {revealed ? "Reference revealed" : "Reveal the reference approach"} <ArrowRight size={14} />
        </button>
      </div>
      {revealed && <div role="status" style={{ marginTop: 20, padding: 17, borderRadius: 14, background: "var(--mint)" }}>
        <strong><Check size={14} style={{ verticalAlign: -2, marginRight: 6 }} />The reference approach.</strong>
        <p style={{ fontSize: 12, lineHeight: 1.6, marginTop: 7 }}>{challenge.objective}</p>
        {challenge.concepts.length > 0 && <ul style={{ margin: "10px 0 0", paddingInlineStart: 18, fontSize: 12, lineHeight: 1.7 }}>
          {challenge.concepts.map((concept) => <li key={concept}>{concept}</li>)}
        </ul>}
      </div>}
    </section>

    <div className="grid grid-2" style={{ marginTop: 18 }}>
      <div className="card pad">
        <CircleHelp size={18} />
        <h3 style={{ marginTop: 14 }}>How to self-check</h3>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginTop: 8 }}>Could you explain your choice to someone else without notes? If not, the lesson is the fastest fix.</p>
      </div>
      <div className="card pad">
        <RotateCcw size={18} />
        <h3 style={{ marginTop: 14 }}>Keep the loop going</h3>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginTop: 8 }}>After feedback, revisit the lesson or take another challenge.</p>
        <Link href={challenge.lessonHref} className="btn btn-ghost" style={{ marginTop: 14 }}>Review concept <ArrowRight size={14} /></Link>
      </div>
    </div>
  </div>;
}
