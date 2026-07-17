import { createStore } from 'jotai';

/**
 * The single jotai store for the whole app. Written from outside React (`apiFetch`, `errorBanner.ts`,
 * `NavGate.tsx`'s effect) via `.get()`/`.set()`, and read from components via `useAtomValue`/`useAtom` — both
 * only see the same state if they share this exact instance. `<Provider store={store}>` (see `Providers.tsx`)
 * must be given this same store; `Provider` silently creates its own separate store via `createStore()` if none
 * is passed, which would desync from every `.get()`/`.set()` call below.
 */
export const store = createStore();
