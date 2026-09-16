"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowRight, FlaskConical, LogOut } from "lucide-react";
import { DemoDashboard } from "@/components/demo-dashboard";
import { DEMO_COOKIE, setDemoMode } from "@/lib/user-state";

const DEMO_CHANGE_EVENT = "learningos:demo-change";

function demoCookieEnabled(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((part) => part.trim() === `${DEMO_COOKIE}=on`);
}

function getServerDemoSnapshot(): boolean {
  return false;
}

function subscribeToDemoCookie(onChange: () => void) {
  window.addEventListener(DEMO_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(DEMO_CHANGE_EVENT, onChange);
}

/** The cookie is the source of truth; notify the store after each write. */
function setDemoPreview(enabled: boolean) {
  setDemoMode(enabled);
  window.dispatchEvent(new Event(DEMO_CHANGE_EVENT));
}

/**
 * Public, self-contained demo preview. Sample data renders only on this page —
 * the authenticated app always shows real account state. Demo mode never
 * requires (or grants) access to the app itself.
 */
export default function DemoPage() {
  const demo = useSyncExternalStore(subscribeToDemoCookie, demoCookieEnabled, getServerDemoSnapshot);

  function enableDemo() {
    setDemoPreview(true);
  }

  function exitDemo() {
    setDemoPreview(false);
  }

  if (demo) {
    return <>
      <div className="demo-banner" role="status">
        <FlaskConical size={14} aria-hidden="true" />
        <p className="demo-banner-text">Demo mode — you are viewing sample learning data. It is separate from real accounts.</p>
        <button type="button" className="demo-banner-exit" onClick={exitDemo}>
          Exit demo
        </button>
      </div>
      <DemoDashboard />
    </>;
  }

  return <main className="container">
    <div style={{ maxWidth: 560, margin: "70px auto" }}>
      <div className="move-icon" style={{ background: "var(--mint)", color: "var(--ink)" }}><FlaskConical size={22} /></div>
      <div className="eyebrow" style={{ marginTop: 24 }}>OPTIONAL</div>
      <h1 style={{ fontSize: 42, marginTop: 12 }}>Demo mode</h1>
      <p className="muted" style={{ lineHeight: 1.7, marginTop: 14 }}>LearningOS starts empty — no sample goals, progress, or history. Demo mode fills this preview with sample learning data so you can explore the experience. It is clearly labeled, easy to exit, never enabled by default, and completely separate from real accounts.</p>
      <div style={{ display: "grid", gap: 10, marginTop: 28 }}>
        <button type="button" className="btn btn-dark" onClick={enableDemo}><FlaskConical size={15} />Enable demo mode<ArrowRight size={14} /></button>
        <Link href="/signup" className="btn btn-ghost"><LogOut size={15} />Skip the demo — create an account</Link>
      </div>
      <p className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 22 }}>You can exit demo mode at any time from the banner shown while it is active.</p>
    </div>
  </main>;
}
