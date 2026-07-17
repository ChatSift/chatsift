import { atom } from 'jotai';

/**
 * In-memory access token — never persisted to localStorage or cookies.
 * Written by apiFetch when the server sends the access-token-refresh header.
 * Read by apiFetch on subsequent requests as the raw `Authorization` header value
 * (the API expects the bare JWT, not a `Bearer ` prefixed scheme).
 */
export const accessTokenAtom = atom<string | null>(null);
