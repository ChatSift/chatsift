import { atom } from 'jotai';

/**
 * In-memory access token — never persisted to localStorage or cookies.
 * Written by apiFetch when the server sends the access-token-refresh header.
 * Read by apiFetch on subsequent requests as the raw `Authorization` header value
 * (the API expects the bare JWT, not a `Bearer ` prefixed scheme).
 */
export const accessTokenAtom = atom<string | null>(null);

/**
 * Timestamp of the last explicit `useLogout()` call (`Date.now()`, `0` if none this session). `NavGateProvider`
 * checks this to distinguish "the user just clicked logout and `user: null` is expected" — `LogoutButton` already
 * handles navigation for that case — from "the session actually expired while browsing a /dashboard page", which
 * should still trigger `NavGateProvider`'s own redirect-to-Discord effect.
 */
export const lastExplicitLogoutAtAtom = atom<number>(0);
