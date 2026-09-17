"use client";

import { useEffect } from "react";
import { useNotificationReadSync } from "@/components/user-state-provider";

/**
 * The live "N unread signals" description on the notifications page.
 *
 * The number itself is resolved on the server from the persisted
 * notification_reads rows, which stays the source of truth. This island only
 * mirrors it so that opening a signal drops the count on the same click: it
 * seeds the shared unread count with the server figure, then renders whatever
 * the shared count currently is (including the optimistic read transitions the
 * rows make). No refresh and no reload are involved.
 */
export function UnreadSummary({ pathTitle, unread }: { pathTitle: string; unread: number }) {
  const { count, seedUnread } = useNotificationReadSync();

  useEffect(() => {
    seedUnread(unread);
  }, [seedUnread, unread]);

  const current = count ?? unread;

  return (
    <>
      {current > 0
        ? `${current} unread ${current === 1 ? "signal" : "signals"} from “${pathTitle}” — videos loading, what is next, and milestones you have earned.`
        : `You are up to date on “${pathTitle}”. New signals will appear here as your path moves.`}
    </>
  );
}
