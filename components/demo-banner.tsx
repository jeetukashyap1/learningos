"use client";

import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { setDemoMode } from "@/lib/user-state";

/**
 * Shown only when demo mode is explicitly enabled. Makes sample data
 * impossible to mistake for real learning history.
 */
export function DemoBanner() {
  const router = useRouter();
  return (
    <div className="demo-banner">
      <FlaskConical size={14} aria-hidden="true" />
      <p className="demo-banner-text">Demo mode — you are viewing sample learning data.</p>
      <button
        type="button"
        className="demo-banner-exit"
        onClick={() => {
          setDemoMode(false);
          router.refresh();
        }}
      >
        Exit demo
      </button>
    </div>
  );
}
