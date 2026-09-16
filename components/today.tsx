"use client";

import { useSyncExternalStore } from "react";
import { formatToday, getGreeting } from "@/lib/datetime";

const emptySubscribe = () => () => {};

/**
 * Hydration-safe mounted flag: false during SSR and the first client render,
 * true afterwards. Uses useSyncExternalStore so no setState runs in an effect.
 */
function useMounted(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

/**
 * Runtime date line, e.g. "Monday, September 7". Renders "Today" on the
 * server and first client paint, then swaps to the real local date after
 * mount — this avoids hydration mismatches while never showing a fake date.
 */
export function Today() {
  const mounted = useMounted();
  return <>{mounted ? formatToday() : "Today"}</>;
}

/**
 * Time-of-day greeting (Good morning / afternoon / evening / night),
 * computed from the visitor's real local time. Renders "Hello" until
 * mounted. An optional name is appended after the greeting.
 */
export function Greeting({ name }: { name?: React.ReactNode }) {
  const mounted = useMounted();
  const greeting = mounted ? getGreeting() : "Hello";
  return <>{name ? <>{greeting}, {name}.</> : <>{greeting}.</>}</>;
}
