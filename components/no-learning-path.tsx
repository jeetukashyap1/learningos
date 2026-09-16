import { Compass, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/**
 * The shared no-path empty state (spec part 10): one honest "your
 * learning has not started yet" moment, reused by every section so the
 * design, the copy tone, and the next action stay consistent.
 *
 * A persisted learning path is the only thing that fills these pages.
 * Onboarding answers alone are never a path (spec part 11), so the
 * single next action is always the same CTA into onboarding.
 */
export function NoLearningPath({
  icon = Compass,
  eyebrow = "YOUR LEARNING STARTS WITH A PATH",
  title = "No learning path yet.",
  description = "This page fills in from your learning path. Create one and your real lessons, skills, and progress appear here.",
  compact = false,
}: {
  icon?: LucideIcon;
  eyebrow?: string;
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <EmptyState
      icon={icon}
      eyebrow={eyebrow}
      title={title}
      description={description}
      actionLabel="Create your learning path"
      actionHref="/onboarding"
      compact={compact}
    />
  );
}
