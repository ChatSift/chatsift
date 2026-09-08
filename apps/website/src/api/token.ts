import { atom } from 'jotai';

/**
 * Timestamp of the last explicit `useLogout()` call (`Date.now()`, `0` if none this session). `NavGateProvider`
 * checks this to distinguish "the user just clicked logout and `user: null` is expected" -- `LogoutButton` already
 * handles navigation for that case -- from "the session actually expired while browsing a /dashboard page", which
 * should still trigger `NavGateProvider`'s own redirect-to-Discord effect.
 *
 * Stays app-local while `accessTokenAtom` moved to `@chatsift/web-core`: this one is about the dashboard's
 * navigation gate, which no other app has.
 */
export const lastExplicitLogoutAtAtom = atom<number>(0);
