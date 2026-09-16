import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * Product-grade empty state: an icon, a clear label, honest copy, and one
 * next action. Rendered whenever a section has no real data to show —
 * empty states are product states, not error states.
 */
export function EmptyState({
  icon: Icon,
  eyebrow,
  title,
  description,
  actionLabel,
  actionHref,
  compact = false,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "empty-state compact" : "empty-state"}>
      <span className="empty-state-icon" aria-hidden="true">
        <Icon size={compact ? 18 : 22} strokeWidth={1.8} />
      </span>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p className="empty-state-copy">{description}</p>
      {actionHref && actionLabel ? (
        <Link className="btn btn-primary" href={actionHref}>
          {actionLabel}
        </Link>
      ) : null}
    </section>
  );
}
