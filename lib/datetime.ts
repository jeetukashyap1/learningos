/**
 * Runtime date + greeting helpers.
 *
 * Always computed from the visitor's real clock — never hardcoded. Use from
 * client components that render after mount (see components/today.tsx) so
 * server and client markup match during hydration.
 */

export type Greeting =
  | "Good morning"
  | "Good afternoon"
  | "Good evening"
  | "Good night";

export function getGreeting(date: Date = new Date()): Greeting {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 21) return "Good evening";
  return "Good night";
}

/** e.g. "Monday, September 7" — formatted from the visitor's real clock. */
export function formatToday(date: Date = new Date()): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
