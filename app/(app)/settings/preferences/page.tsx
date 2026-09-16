"use client";

import Link from "next/link";
import { Check, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export default function PreferencesPage() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const savedTheme = window.localStorage.getItem("learningos-theme");
    return savedTheme === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("learningos-theme", theme);
  }, [theme]);

  return (
    <main className="container">
      <Link href="/settings" className="muted" style={{ fontSize: 12, fontWeight: 800 }}>
        ← Settings
      </Link>
      <div style={{ maxWidth: 720, margin: "30px auto" }}>
        <div className="eyebrow">PREFERENCES</div>
        <h1 style={{ marginTop: 12 }}>Shape your rhythm.</h1>
        <div className="card pad" style={{ marginTop: 28 }}>
          <h3>Appearance</h3>
          <div style={{ display: "flex", gap: 10, marginTop: 15 }}>
            {([{ id: "light", label: "Light", icon: Sun }, { id: "dark", label: "Dark", icon: Moon }] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                aria-pressed={theme === id}
                className="btn btn-ghost"
                style={{ border: `1px solid ${theme === id ? "var(--ink)" : "var(--line)"}`, background: theme === id ? "var(--lime)" : "var(--paper)" }}
              >
                <Icon size={14} />
                {label}
                {theme === id && <Check size={13} />}
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 16 }}>
            Choose the visual environment that makes it easier to return to your next step.
          </p>
          <div className="list-row" style={{ marginTop: 20 }}>
            <div>
              <strong style={{ fontSize: 13 }}>Learning reminders</strong>
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>A gentle nudge when a review is worth doing.</p>
            </div>
            <input type="checkbox" defaultChecked aria-label="Enable learning reminders" />
          </div>
        </div>
      </div>
    </main>
  );
}
