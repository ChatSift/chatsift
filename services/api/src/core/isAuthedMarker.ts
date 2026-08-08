/**
 * Marks every middleware `middleware/isAuthed.ts`'s `isAuthed()` returns, so `server.ts`'s boot-time
 * guild-scoped route guard can tell "this route is authed via `isAuthed`" apart from routes authed some other
 * way entirely (`requireMetricsSecret`, `requireWebhookSecret`) without needing its own opt-in on every route
 * definition.
 *
 * Kept in its own module rather than defined in `isAuthed.ts` directly -- `server.ts` needs this symbol at
 * import time for every route (including ones with no auth at all), and `isAuthed.ts` transitively pulls in
 * `jsonwebtoken` and the Discord REST clients (`util/discordAPI.ts`, which reads `getContext()` at module load
 * time). Importing `isAuthed.ts` from `server.ts` for just this symbol would make every test that imports
 * `server.ts` -- even ones with nothing to do with auth -- responsible for having a full `Context` initialized
 * first.
 */
export const IS_AUTHED_MARKER = Symbol('isAuthed');
