import { DiscordAPIError } from '@discordjs/rest';

/**
 * Whether `error` is discord rejecting the credential a request was made with, rather than any other kind of
 * failure.
 *
 * Deliberately narrow. Callers use this to decide that a stored OAuth token is dead, and act on that by
 * spending a refresh-token rotation or forcing a re-login -- but a 5xx, a rate limit, or a socket error says
 * nothing at all about whether the token is still good, so treating those the same way would throw away
 * working sessions over transient discord blips.
 *
 * Lives here rather than in `discordAPI.ts` so it can be imported without pulling in that module's
 * `REST`/`API` client construction, which reads bot tokens off the context at module scope.
 */
export function isUnauthorizedDiscordError(error: unknown): boolean {
	return error instanceof DiscordAPIError && error.status === 401;
}
