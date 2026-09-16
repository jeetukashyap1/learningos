import Link from "next/link";
import { ArrowRight, BrainCircuit, Check, Compass, Map, Play, Sparkles, Target, Timer } from "lucide-react";

const steps = [
  { icon: Compass, title: "Choose your direction", text: "Tell us what you want to be able to do—not just what course to watch." },
  { icon: Map, title: "Get your path", text: "LearningOS turns your goal into a visual sequence of skills and concepts." },
  { icon: Target, title: "Learn by doing", text: "Short explanations, active practice, and challenges make progress tangible." }
];

export default function LandingPage() {
  return (
    <main>
      <nav className="landing-nav">
        <Link className="brand" href="/"><span className="brand-mark" />LearningOS</Link>
        <div className="landing-links">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/login" className="btn btn-dark">Log in <ArrowRight size={14} /></Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div>
          <div className="tag"><Sparkles size={12} style={{ marginRight: 6 }} />The learning operating system</div>
          <h1>Learn what <span style={{ color: "var(--orange)" }}>matters.</span><br />We build the path.</h1>
          <p className="muted landing-lede">Tell us what you want to learn. LearningOS builds a personalized path, finds useful resources, helps you practice, and knows what you should do next.</p>
          <div className="landing-actions"><Link href="/signup" className="btn btn-dark">Start learning <ArrowRight size={15} /></Link><Link href="/how-it-works" className="btn btn-ghost">See how it works <Play size={14} /></Link></div>
        </div>

        <div className="product-preview">
          <div className="preview-topline"><span className="eyebrow" style={{ color: "var(--lime)" }}>NEXT BEST MOVE</span><span className="preview-dot" /></div>
          <h2>Build your first API</h2>
          <p className="preview-copy">A focused step selected for your current path—not another tab to keep open.</p>
          <div className="preview-meta"><span><Timer size={13} />15 min</span><span>Intermediate</span></div>
          <div className="preview-loop"><span>Learn</span><i>→</i><span>Practice</span><i>→</i><span>Prove</span></div>
          <div className="preview-concepts"><div><span className="mono">EXAMPLE PATH</span><strong>APIs and backends</strong></div><p><b>REST methods</b> unlock the next project milestone.</p></div>
          <Link href="/signup" className="btn btn-primary" style={{ marginTop: 22 }}>Start your path <ArrowRight size={14} /></Link>
        </div>
      </section>

      <section className="landing-section learning-demo">
        <div className="section-kicker">FROM PASSIVE TO ACTIVE</div>
        <div className="demo-heading"><h2>Learning should not feel like watching a playlist.</h2><p className="muted">Every useful explanation creates a moment to think, try, and apply.</p></div>
        <div className="learning-flow"><div className="flow-steps">{["WATCH", "PREDICT", "TRY", "FEEDBACK", "BUILD"].map((step, index) => <div className={`flow-step ${index === 2 ? "active" : ""}`} key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong>{index < 4 && <i>↓</i>}</div>)}</div><div className="demo-challenge"><div className="eyebrow">WHAT HAPPENS NEXT?</div><h3>Your API receives a POST request without a required field.</h3><p className="muted">What should the server do?</p><div className="demo-options"><button type="button" className="demo-option"><span>Return 400</span><Check size={14} /></button><button type="button" className="demo-option">Return 200</button><button type="button" className="demo-option">Retry automatically</button></div><div className="demo-footer"><BrainCircuit size={15} />A small decision makes the next explanation useful.</div></div></div>
      </section>

      <section className="landing-section capability-section"><div className="section-kicker">PROGRESS THAT FEELS LIKE CAPABILITY</div><h2>Know what to do next.</h2><p className="muted capability-lede">LearningOS makes the path visible, so progress is more than a percentage.</p><div className="capability-grid">{steps.map(({ icon: Icon, title, text }, index) => <div className="capability-item" key={title}><div className="capability-number">0{index + 1}</div><Icon size={19} color="var(--orange)" /><h3>{title}</h3><p className="muted">{text}</p></div>)}</div><div className="loop-line"><span>Curiosity</span><b>→</b><span>Learn</span><b>→</b><span>Challenge</span><b>→</b><span>Feedback</span><b>→</b><span>Apply</span><b>→</b><span>Next best move</span></div></section>

      <footer className="landing-footer"><Link className="brand" href="/"><span className="brand-mark" />LearningOS</Link><span className="muted">A clearer way to become capable.</span><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/contact">Contact</Link></div></footer>
    </main>
  );
}
