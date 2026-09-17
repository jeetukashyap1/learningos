"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BrainCircuit, ChevronRight, CircleUserRound, Compass, FolderKanban, Gauge, Home, LogOut, Map, Route, Search, Settings, Sparkles, Target, Zap } from "lucide-react";
import { useCurrentUser, useSearchItems, useUserState } from "@/components/user-state-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SearchItem } from "@/lib/user-state";

const primary = [{ href: "/dashboard", label: "Home", icon: Home }, { href: "/journey", label: "My Journey", icon: Compass }, { href: "/paths", label: "My Paths", icon: Route }, { href: "/skills", label: "Skill Map", icon: Map }, { href: "/quick-learn", label: "Quick Learn", icon: Zap }, { href: "/practice", label: "Practice", icon: Target }, { href: "/projects", label: "Projects", icon: FolderKanban }, { href: "/progress", label: "Progress", icon: Gauge }];
const secondary = [{ href: "/ai-tutor", label: "AI Tutor", icon: BrainCircuit }, { href: "/notifications", label: "Notifications", icon: Bell }, { href: "/profile", label: "Profile", icon: CircleUserRound }, { href: "/settings", label: "Settings", icon: Settings }];

// Nested route sections roll up to their parent nav entry.
const nestedNavParents: Record<string, string> = { "/challenges": "/practice", "/learn": "/quick-learn" };

function isNavActive(pathname: string, href: string): boolean {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  const [section] = pathname.split("/").filter(Boolean);
  return !!section && nestedNavParents[`/${section}`] === href;
}

function NavLinks({ items, showNotificationDot = false }: { items: typeof primary; showNotificationDot?: boolean }) {
  const pathname = usePathname();
  return <nav className="nav" aria-label="Main navigation">{items.map(({ href, label, icon: Icon }) => {
    const active = isNavActive(pathname, href);
    return <Link href={href} key={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}><Icon size={16} strokeWidth={1.8} />{label}{label === "Notifications" && showNotificationDot && <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "var(--orange)" }} />}</Link>;
  })}</nav>;
}

export function AppSidebar() {
  const state = useUserState();
  return <aside className="sidebar">
    <Link className="brand" href="/dashboard"><span className="brand-mark" />LearningOS</Link>
    <div className="sidebar-scroll">
      <div className="nav-label">Your learning</div>
      <NavLinks items={primary} />
    </div>
    <div className="sidebar-bottom">
      <div className="nav-label">Workspace</div>
      {/* The dot reflects REAL read state: it shows only while at least one
          derived signal is still unread (no notification_reads row). It used
          to be keyed to learning history, which lit it up for every learner
          with lessons whether or not anything was actually unread. */}
      <NavLinks items={secondary} showNotificationDot={state.hasUnreadNotifications} />
      {state.hasLearningPath ? (
        <div className="card" style={{ marginTop: 22, padding: 15, background: "var(--lime)", boxShadow: "none" }}>
          <Sparkles size={16} />
          <p style={{ fontWeight: 800, fontSize: 12, marginTop: 10 }}>Keep your momentum</p>
          <p className="muted" style={{ fontSize: 10, marginTop: 4 }}>12 minutes is enough for a meaningful win.</p>
          <Link href="/paths" style={{ display: "inline-block", marginTop: 8, fontSize: 10, fontWeight: 800 }}>My paths →</Link>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 22, padding: 15, background: "var(--lime)", boxShadow: "none" }}>
          <Sparkles size={16} />
          <p style={{ fontWeight: 800, fontSize: 12, marginTop: 10 }}>Start your path</p>
          <p className="muted" style={{ fontSize: 10, marginTop: 4 }}>Two minutes to set your direction.</p>
          <Link href="/onboarding" className="btn btn-dark" style={{ marginTop: 12, width: "100%", fontSize: 11, padding: "9px 12px" }}>Create your path</Link>
        </div>
      )}
    </div>
  </aside>;
}

// App pages are always searchable. Content entries (lessons and the path
// itself) come from the provider: real persisted rows for a signed-in
// learner, nothing for everyone else (spec parts 2 + 35 - search never
// invents content).
const pageItems: SearchItem[] = [...primary, ...secondary].map(({ href, label }) => ({ title: label, kind: "Page", href }));

// Frozen sample entries for anonymous demo mode only - a deliberate
// preview of a finished learning space. Signed-in learners never see
// these; their results come from their own path via useSearchItems().
const sampleItems: SearchItem[] = [
  { title: "JavaScript Async/Await", kind: "Lesson", href: "/learn/async-await", hint: "Async JavaScript" },
  { title: "Understand REST API methods", kind: "Lesson", href: "/learn/rest-methods", hint: "Backend fundamentals" },
  { title: "Choose the right REST method", kind: "Challenge", href: "/challenges/rest-methods", hint: "REST API methods" },
  { title: "Real-Time Weather Dashboard", kind: "Project", href: "/projects", hint: "Build a weather interface that fetches, transforms, and renders live data." },
  { title: "Expense Tracker", kind: "Project", href: "/projects", hint: "Turn local data into a useful personal finance tool with filters and totals." },
  { title: "REST API", kind: "Project", href: "/projects", hint: "Design a clean backend service with resource routes and meaningful responses." },
  { title: "HTML & CSS", kind: "Skill", href: "/skills", hint: "12 concepts mastered" },
  { title: "JavaScript", kind: "Skill", href: "/skills", hint: "9 of 14 concepts" },
  { title: "Async JavaScript", kind: "Skill", href: "/skills", hint: "Worth another pass" },
  { title: "React", kind: "Skill", href: "/skills", hint: "Complete prerequisites" },
];

function findSearchResults(query: string, contentItems: SearchItem[]): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return [...pageItems, ...contentItems].filter((item) => item.title.toLowerCase().includes(q) || (item.hint ?? "").toLowerCase().includes(q)).slice(0, 8);
}

export function TopBar() {
  const user = useCurrentUser();
  const state = useUserState();
  const searchItems = useSearchItems();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const initial = user?.fullName?.trim().charAt(0).toUpperCase() || null;
  // Anonymous demo mode keeps the frozen sample entries; a signed-in
  // learner searches their real path (provider items), and everyone else
  // gets pages only (spec part 35).
  const contentItems = !user && state.hasLearningPath ? sampleItems : searchItems;
  const results = useMemo(() => findSearchResults(query, contentItems), [query, contentItems]);

  // Global ⌘K / Ctrl+K moves focus to the search field.
  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      event.currentTarget.blur();
      return;
    }
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const item = results[activeIndex];
      if (item) {
        setOpen(false);
        setQuery("");
        router.push(item.href);
      }
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await getSupabaseBrowserClient().auth.signOut();
    } finally {
      // Even if the network call fails, leave the app: cookies are cleared
      // client-side by signOut and middleware will re-challenge on next load.
      router.replace("/login");
      router.refresh();
    }
  }

  return <header className="topbar"><div className="search" ref={searchBoxRef} onBlur={(event) => { const next = event.relatedTarget; if (!(next instanceof Node) || !searchBoxRef.current?.contains(next)) setOpen(false); }}><Search size={16} /><input ref={searchRef} type="search" placeholder="Search your learning space" aria-label="Search your learning space" autoComplete="off" spellCheck={false} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={handleSearchKeyDown} /><kbd style={{ fontSize: 10, border: "1px solid var(--line)", padding: "3px 6px", borderRadius: 5 }}>⌘ K</kbd>{open && (query.trim() === "" ? <div className="search-results"><div className="search-empty">Search pages, lessons, challenges, projects, and skills.</div></div> : results.length === 0 ? <div className="search-results"><div className="search-empty">No results found for “{query.trim()}”.</div></div> : <div className="search-results" aria-label="Search results">{results.map((item, index) => <Link href={item.href} key={`${item.href}-${item.title}`} className={index === activeIndex ? "selected" : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(false); setQuery(""); }}>{item.title}<span className="kind">{item.kind}</span></Link>)}</div>)}</div><div className="top-actions"><Link className="icon-btn" href="/notifications" aria-label="Notifications"><Bell size={18} /></Link>{user ? <button type="button" className="icon-btn" onClick={handleSignOut} disabled={signingOut} aria-label="Sign out" title="Sign out" style={{ cursor: "pointer" }}>{signingOut ? <span style={{ fontSize: 10, fontWeight: 800 }}>…</span> : <LogOut size={18} />}</button> : null}<Link className="avatar" href="/profile" aria-label="Open profile" style={{ color: "white" }}>{initial ? <span aria-hidden="true" style={{ fontSize: 13, fontWeight: 800, lineHeight: 1 }}>{initial}</span> : <CircleUserRound size={19} />}</Link></div></header>;
}

export function MobileNav() {
  const pathname = usePathname();
  return <nav className="mobile-nav" aria-label="Mobile navigation">{[{ href: "/dashboard", label: "Home", icon: Home }, { href: "/journey", label: "Journey", icon: Compass }, { href: "/practice", label: "Practice", icon: Target }, { href: "/ai-tutor", label: "AI", icon: BrainCircuit }, { href: "/profile", label: "Profile", icon: CircleUserRound }].map(({ href, label, icon: Icon }) => {
    const active = isNavActive(pathname, href);
    return <Link href={href} key={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}><Icon size={18} /><span>{label}</span></Link>;
  })}</nav>;
}

export function AppShell({ children, banner }: { children: React.ReactNode; banner?: React.ReactNode }) {
  return <div className="shell"><AppSidebar /><div className="main">{banner}<TopBar />{children}</div><MobileNav /></div>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "end", flexWrap: "wrap", marginBottom: 30 }}><div><div className="eyebrow">{eyebrow}</div><h1 style={{ marginTop: 12 }}>{title}</h1>{description && <p className="muted" style={{ marginTop: 12, maxWidth: 600, fontSize: 14, lineHeight: 1.6 }}>{description}</p>}</div>{action}</div>;
}

export function ArrowLink({ children, href = "#" }: { children: React.ReactNode; href?: string }) {
  return <Link href={href} className="btn btn-ghost">{children}<ChevronRight size={14} /></Link>;
}
