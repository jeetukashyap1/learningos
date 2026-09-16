"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EMPTY_USER_STATE, type AuthenticatedUser, type SearchItem, type UserStateFlags } from "@/lib/user-state";

const UserStateContext = createContext<UserStateFlags>(EMPTY_USER_STATE);
const CurrentUserContext = createContext<AuthenticatedUser | null>(null);
const SearchItemsContext = createContext<SearchItem[]>([]);

const NO_SEARCH_ITEMS: SearchItem[] = [];

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
  return (
    <UserStateContext.Provider value={state}>
      <CurrentUserContext.Provider value={user}>
        <SearchItemsContext.Provider value={searchItems}>{children}</SearchItemsContext.Provider>
      </CurrentUserContext.Provider>
    </UserStateContext.Provider>
  );
}

/**
 * Honest UI flags for the current visitor — resolved once on the server from
 * the real session (or the demo cookie for anonymous visitors) and shared
 * with every client page.
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
