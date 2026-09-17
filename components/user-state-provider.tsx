"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { EMPTY_USER_STATE, type AuthenticatedUser, type SearchItem, type UserStateFlags } from "@/lib/user-state";

const UserStateContext = createContext<UserStateFlags>(EMPTY_USER_STATE);
const CurrentUserContext = createContext<AuthenticatedUser | null>(null);
const SearchItemsContext = createContext<SearchItem[]>([]);

const NO_SEARCH_ITEMS: SearchItem[] = [];

/**
 * Client-side handle on the unread notification count.
 *
 * Supabase's notification_reads table stays the single source of truth: this
 * only mirrors the server-resolved count so a signal that was just opened can
 * leave the count - and the sidebar dot - on the same click, with no router
 * refresh and no page reload. `count` is null until a page that knows the
 * exact figure (the notifications page) seeds it with the server value, and
 * it only ever moves DOWN inside a session, because the only thing that moves
 * it is a signal this learner actually read (already persisted by the API).
 */
interface UnreadNotifications {
  count: number | null;
  seedUnread: (count: number) => void;
  markSignalRead: () => void;
}

const EMPTY_UNREAD: UnreadNotifications = {
  count: null,
  seedUnread: () => {},
  markSignalRead: () => {},
};

const UnreadNotificationsContext = createContext<UnreadNotifications>(EMPTY_UNREAD);

export function UserStateProvider({
  state,
  user = null,
  searchItems = NO_SEARCH_ITEMS,
  children,
}: {
  state: UserStateFlags;
  user?: AuthenticatedUser | null;
  searchItems?: SearchItem[];
  children: ReactNode;
}) {
  const [unreadOverride, setUnreadOverride] = useState<number | null>(null);

  const seedUnread = useCallback((count: number) => setUnreadOverride(count), []);
  const markSignalRead = useCallback(
    () => setUnreadOverride((current) => (current === null ? current : Math.max(0, current - 1))),
    [],
  );

  const unread = useMemo<UnreadNotifications>(
    () => ({ count: unreadOverride, seedUnread, markSignalRead }),
    [unreadOverride, seedUnread, markSignalRead],
  );

  // The sidebar dot keeps reading the same flag as before; it just follows the
  // client-side count while a read transition is in flight, instead of waiting
  // for the shared layout to be re-rendered from the server.
  const flags = useMemo<UserStateFlags>(
    () => (unreadOverride === null ? state : { ...state, hasUnreadNotifications: unreadOverride > 0 }),
    [state, unreadOverride],
  );

  return (
    <UnreadNotificationsContext.Provider value={unread}>
      <UserStateContext.Provider value={flags}>
        <CurrentUserContext.Provider value={user}>
          <SearchItemsContext.Provider value={searchItems}>{children}</SearchItemsContext.Provider>
        </CurrentUserContext.Provider>
      </UserStateContext.Provider>
    </UnreadNotificationsContext.Provider>
  );
}

/**
 * Honest UI flags for the current visitor — resolved once on the server from
 * the real session (or the demo cookie for anonymous visitors) and shared
 * with every client page. `hasUnreadNotifications` follows the read
 * transitions this learner makes in the current session.
 */
export function useUserState(): UserStateFlags {
  return useContext(UserStateContext);
}

/**
 * The signed-in user, or null when nobody is authenticated (demo or
 * anonymous). Client components use this instead of touching Supabase.
 */
export function useCurrentUser(): AuthenticatedUser | null {
  return useContext(CurrentUserContext);
}

/**
 * Searchable content entries for the global search: the signed-in
 * learner's real lessons and path, resolved once on the server. Empty for
 * anonymous visitors - demo mode keeps its frozen sample set inside the
 * shell instead of flowing it through here.
 */
export function useSearchItems(): SearchItem[] {
  return useContext(SearchItemsContext);
}

/**
 * The client mirror of the unread notification count. The notifications page
 * seeds the real server figure and drops it by one as each signal is read, so
 * the visible count and the sidebar dot never wait for a refresh. Persistence
 * stays in Supabase - this is display state only, not a second store of
 * notification content or read state.
 */
export function useNotificationReadSync(): UnreadNotifications {
  return useContext(UnreadNotificationsContext);
}
