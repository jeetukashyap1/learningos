"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { describeAuthError } from "@/lib/auth-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const TOTAL_STEPS = 6;

const levels = [
  { id: "fresh", title: "Starting fresh", detail: "New to this area of learning" },
  { id: "basics", title: "I know some basics", detail: "Comfortable with the fundamentals" },
  { id: "building", title: "Building on what I know", detail: "Ready for deeper, connected work" },
];

const times = [
  { id: "15", title: "15 minutes a day", detail: "Small, consistent steps" },
  { id: "30", title: "30 minutes a day", detail: "One focused daily session" },
  { id: "60", title: "An hour a day", detail: "Serious, structured progress" },
  { id: "weekend", title: "Weekends", detail: "Longer, less frequent sessions" },
];

const goals = [
  { id: "career", title: "A career move", detail: "Working toward a professional goal" },
  { id: "job", title: "My current work", detail: "Solving real problems I face today" },
  { id: "project", title: "A specific project", detail: "Learning with a build in mind" },
  { id: "curiosity", title: "Curiosity", detail: "Learning because it matters to me" },
];

/**
 * Preferred video language (spec part 6). "hinglish" is a real product
 * preference, not a BCP-47 code: the YouTube engine handles it through
 * language-aware queries and ranking instead of an API language parameter.
 */
const videoLanguages = [
  { id: "en", title: "English", detail: "Videos taught in English" },
  { id: "hi", title: "Hindi", detail: "Videos taught in Hindi" },
  { id: "hinglish", title: "Hinglish", detail: "Hindi and English mixed, the way many Indian creators teach" },
  { id: "any", title: "No preference", detail: "The best teaching video, in any language" },
];

/** Domain-neutral suggestions: any student should see themselves here (spec part 5). */
const suggestions = ["Class 12 Physics", "Spoken English", "UI design with Figma", "Web development", "Mathematics"];

function OptionCard({ title, detail, selected, onSelect }: { title: string; detail: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={selected ? "onboarding-option selected" : "onboarding-option"} onClick={onSelect} aria-pressed={selected}>
      <span><strong>{title}</strong><small>{detail}</small></span>
      {selected && <Check size={16} aria-hidden="true" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Real generation stages (spec part 11)
// ---------------------------------------------------------------------------

/**
 * Each stage maps to one actual round trip - there are no fake timers:
 * a stage is only shown while its request is in flight, a checkmark only
 * appears once that request succeeded, and success is only declared after
 * everything is actually persisted.
 */
type Stage = "saving" | "generating" | "finding-resources";

type Phase = Stage | "idle" | "error";

/** The stage that was in flight when the flow failed - drives the retry UI. */
type FailedStage = Stage;

const STAGES: ReadonlyArray<{ id: Stage; label: string; detail: string }> = [
  { id: "saving", label: "Saving your answers", detail: "Topic, level, time, purpose, and video language are saved to your account" },
  { id: "generating", label: "Designing your lessons", detail: "Your AI mentor builds a personalized curriculum and saves it" },
  { id: "finding-resources", label: "Finding videos for your lessons", detail: "Each lesson is matched with the best YouTube tutorials in your preferred language" },
];

function isStage(value: Phase): value is Stage {
  return value === "saving" || value === "generating" || value === "finding-resources";
}

/** Renders the live stage checklist: done stages check off as requests finish. */
function BuildStages({ phase }: { phase: Stage }) {
  const activeIndex = STAGES.findIndex((stage) => stage.id === phase);
  return (
    <div className="card pad" style={{ display: "grid", gap: 16 }} aria-busy="true" aria-live="polite">
      <div className="eyebrow">BUILDING YOUR PATH</div>
      {STAGES.map((stage, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <div key={stage.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", opacity: done || active ? 1 : 0.5 }}>
            {done ? <Check size={16} color="var(--orange)" style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
              : active ? <Loader2 size={16} className="auth-spinner" color="var(--orange)" style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
                : <span aria-hidden="true" style={{ width: 16, height: 16, marginTop: 2, borderRadius: "50%", border: "1.5px solid var(--line)", flexShrink: 0 }} />}
            <span style={{ display: "grid", gap: 2 }}>
              <strong style={{ fontSize: 13 }}>{stage.label}{done ? " — done" : active ? "…" : ""}</strong>
              <small className="muted" style={{ fontSize: 12 }}>{stage.detail}</small>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Extracts the safe message the API routes put in { error: string }. */
function safeApiError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const message = (body as { error?: unknown }).error;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

/** Placeholder for navigation without query params (React.use needs a promise). */
const EMPTY_SEARCH_PARAMS: { new?: string | string[] } = {};

export default function OnboardingPage({ searchParams }: { searchParams?: Promise<{ new?: string | string[] }> }) {
  const router = useRouter();
  // ?new=1 = the explicit "create an additional path" flow (spec part 17):
  // it always inserts a separate path instead of reusing the active one.
  const params = use(searchParams ?? Promise.resolve(EMPTY_SEARCH_PARAMS));
  const creatingNewPath = params.new === "1";
  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [videoLanguage, setVideoLanguage] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [failedStage, setFailedStage] = useState<FailedStage | null>(null);

  const canContinue =
    step === 0 ? topic.trim().length > 0 :
    step === 1 ? level !== null :
    step === 2 ? time !== null :
    step === 3 ? goal !== null :
    step === 4 ? videoLanguage !== null :
    false;

  function fail(stage: FailedStage, message: string) {
    setFailedStage(stage);
    setPhaseError(message);
    setPhase("error");
  }

  /**
   * Runs the REAL generation flow, stage by stage (spec parts 11 and 15):
   *
   * 1. saving            - upsert the answers (incl. video language) to
   *                        onboarding_profiles
   * 2. generating        - POST /api/learning/paths/generate: NVIDIA
   *                        curriculum, path + ordered lessons persisted
   *                        (every lesson starts 'pending')
   * 3. finding-resources - POST /api/learning/paths/attach: the existing
   *                        YouTube engine attaches videos to each lesson,
   *                        honoring the preferred video language
   *
   * The journey page opens only after everything is actually persisted.
   * Every stage is idempotent, so retrying from any failure is safe.
   */
  async function buildPath() {
    if (!topic.trim() || !level || !time || !goal || !videoLanguage) {
      fail("saving", "Some answers are missing. Go back and complete every step.");
      return;
    }
    setPhaseError(null);

    // Stage 1 (real request): persist the answers.
    setPhase("saving");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        fail("saving", "Your session expired while onboarding. Sign in again — your answers are still on this screen.");
        return;
      }
      const { error } = await supabase.from("onboarding_profiles").upsert(
        {
          user_id: user.id,
          topic: topic.trim(),
          current_level: level,
          daily_time: time,
          goal_type: goal,
          video_language: videoLanguage,
        },
        { onConflict: "user_id" },
      );
      if (error) {
        fail("saving", describeAuthError(error));
        return;
      }
    } catch (error) {
      fail("saving", describeAuthError(error));
      return;
    }

    // Stage 2 (real request): AI curriculum -> path + lessons persisted.
    // The explicit new-path flow (spec part 17) always inserts a separate
    // path; the normal flow stays idempotent on unchanged answers.
    setPhase("generating");
    try {
      const response = await fetch(
        creatingNewPath ? "/api/learning/paths/create-new" : "/api/learning/paths/generate",
        { method: "POST" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        fail("generating", safeApiError(body, "We could not create your learning path. Please try again."));
        return;
      }
    } catch {
      fail("generating", "We could not reach LearningOS while creating your path. Check your connection and try again.");
      return;
    }

    // Stage 3 (real request): YouTube engine finds videos for each lesson.
    // A YouTube failure never blocks the path: untouched lessons stay
    // 'pending' and can retry from the journey page.
    setPhase("finding-resources");
    try {
      const response = await fetch("/api/learning/paths/attach", { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        fail("finding-resources", safeApiError(body, "We could not load videos for your lessons. Your path is saved."));
        return;
      }
    } catch {
      fail("finding-resources", "We could not reach LearningOS while loading videos. Your path is saved.");
      return;
    }

    // Success: everything is actually persisted. Revalidate + navigate
    // (spec part 11) - the journey page is the success screen.
    router.push("/journey");
    router.refresh();
  }

  function backToAnswers() {
    setPhase("idle");
    setPhaseError(null);
    setFailedStage(null);
    setStep(4);
  }

  function continueToJourney() {
    router.push("/journey");
    router.refresh();
  }

  const headings = [
    { eyebrow: "STEP 1 OF 6 · YOUR TOPIC", title: "What do you want to learn?", description: "One clear sentence is enough — any subject, any goal. You can refine this later as your direction sharpens." },
    { eyebrow: "STEP 2 OF 6 · YOUR LEVEL", title: "Where are you starting from?", description: "Honest answers make better paths. Your level shapes where the first lessons begin." },
    { eyebrow: "STEP 3 OF 6 · YOUR TIME", title: "How much time can you give it?", description: "LearningOS plans around the time you actually have, not the time you wish you had." },
    { eyebrow: "STEP 4 OF 6 · YOUR WHY", title: "What is this learning for?", description: "A path built for a career move looks different from one built for curiosity." },
    { eyebrow: "STEP 5 OF 6 · VIDEO LANGUAGE", title: "Which language should your videos be in?", description: "Your lessons are taught through YouTube videos. Pick the language you learn best in — it shapes both the search and the ranking." },
    creatingNewPath
      ? { eyebrow: "STEP 6 OF 6 · YOUR NEW PATH", title: "LearningOS builds your new path.", description: "Your answers become a fresh curriculum, saved as a separate path in your library. Your current path stays untouched — switch back any time." }
      : { eyebrow: "STEP 6 OF 6 · YOUR PATH", title: "LearningOS builds your path.", description: "Your answers become a personalized curriculum, then each lesson gets its videos. Real steps, one at a time — no waiting room." },
  ];

  return <main className="container">
    <div className="onboarding">
      <div className="onboarding-progress" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-label={`Onboarding step ${step + 1} of ${TOTAL_STEPS}`}>
        {Array.from({ length: TOTAL_STEPS }, (_, index) => <span key={index} className={index <= step ? "done" : undefined} />)}
      </div>

      <div className="eyebrow" style={{ marginTop: 30 }}>{headings[step].eyebrow}</div>
      <h1 style={{ marginTop: 12, fontSize: 34 }}>{headings[step].title}</h1>
      <p className="muted" style={{ marginTop: 12, lineHeight: 1.7, maxWidth: 520 }}>{headings[step].description}</p>

      <div style={{ marginTop: 30 }}>
        {step === 0 && <div>
          <label className="field-label" htmlFor="onboarding-topic">Your topic</label>
          <input id="onboarding-topic" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="For example: Class 12 physics, spoken English, or UI design" autoComplete="off" maxLength={120} style={{ width: "100%", border: "1px solid var(--line)", background: "var(--paper)", borderRadius: 12, padding: "14px 16px", fontSize: 14 }} />
          <div className="onboarding-chips" style={{ marginTop: 12 }}>
            {suggestions.map((suggestion) => <button type="button" key={suggestion} className="onboarding-chip" aria-pressed={topic === suggestion} onClick={() => setTopic(suggestion)}>{suggestion}</button>)}
          </div>
        </div>}

        {step === 1 && <div className="onboarding-options">{levels.map((item) => <OptionCard key={item.id} title={item.title} detail={item.detail} selected={level === item.id} onSelect={() => setLevel(item.id)} />)}</div>}
        {step === 2 && <div className="onboarding-options">{times.map((item) => <OptionCard key={item.id} title={item.title} detail={item.detail} selected={time === item.id} onSelect={() => setTime(item.id)} />)}</div>}
        {step === 3 && <div className="onboarding-options">{goals.map((item) => <OptionCard key={item.id} title={item.title} detail={item.detail} selected={goal === item.id} onSelect={() => setGoal(item.id)} />)}</div>}
        {step === 4 && <div className="onboarding-options">{videoLanguages.map((item) => <OptionCard key={item.id} title={item.title} detail={item.detail} selected={videoLanguage === item.id} onSelect={() => setVideoLanguage(item.id)} />)}</div>}

        {step === 5 && isStage(phase) && <BuildStages phase={phase} />}

        {step === 5 && phase === "error" && <div className="card pad" style={{ display: "grid", gap: 12 }}>
          <div className="eyebrow">PATH CREATION PAUSED</div>
          <p style={{ fontSize: 14 }}>{phaseError}</p>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            {failedStage === "saving" && <>Your answers are still on this screen — nothing was lost. If your session expired, <Link href="/login?next=/onboarding" className="auth-link">sign in again</Link> and return here.</>}
            {failedStage === "generating" && <>Your answers are saved to your account and nothing else was changed, so trying again is safe.</>}
            {failedStage === "finding-resources" && <>Your path and lessons are saved. Retry the videos now, or continue — they can finish loading from your journey.</>}
          </p>
        </div>}
      </div>

      <div className="onboarding-nav">
        {step > 0 && step < 5 ? <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={14} />Back</button> : <span />}
        {step < 5 ? <button type="button" className="btn btn-primary" disabled={!canContinue} onClick={() => { if (step === 4) { setStep(5); void buildPath(); } else { setStep(step + 1); } }} style={{ opacity: canContinue ? 1 : 0.5 }}>{step === 4 ? "Build my path" : "Continue"}<ArrowRight size={14} /></button> : null}
      </div>

      {step === 5 && phase === "error" && <div className="onboarding-nav" style={{ borderTop: "none", paddingTop: 0 }}>
        <button type="button" className="btn btn-ghost" onClick={backToAnswers}><ArrowLeft size={14} />Back to answers</button>
        <div style={{ display: "flex", gap: 10 }}>
          {failedStage === "finding-resources" && <button type="button" className="btn btn-ghost" onClick={continueToJourney}>Continue to my path</button>}
          <button type="button" className="btn btn-primary" onClick={() => void buildPath()}>Try again</button>
        </div>
      </div>}
    </div>
  </main>;
}
