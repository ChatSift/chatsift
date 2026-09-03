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

/**
 * Whether `error` is discord's *token* endpoint saying the user's grant itself is dead -- and nothing else.
 *
 * Matched on the OAuth error name rather than the status, because status alone is what made this dangerous. A
 * token-endpoint failure has two completely different meanings that both arrive as a 4xx: `invalid_grant` is the
 * user's refresh token being spent or revoked, which genuinely requires a fresh login, while `invalid_client`
 * (which discord answers `401`) is *this service's* credentials being rejected -- a deployment problem that must
 * never cost a single user their session, let alone all of them at once. #384 was exactly that: the rotation call
 * omitted its client credentials, every attempt came back `401 invalid_client`, and the session layer read it as
 * "this user's login is dead" and cleared their cookies.
 *
 * `DiscordAPIError.code` carries the OAuth `error` string verbatim for a token-endpoint response (see
 * `@discordjs/rest`'s `handleErrors`, which passes `data.error` through as the code when the body isn't a
 * regular discord API error), so this reads the one field that actually distinguishes the two.
 *
 * Deliberately narrow, same as `isUnauthorizedDiscordError` above: everything unrecognized -- a 5xx, a rate
 * limit, a socket error, a future error name -- leaves the session intact and surfaces as a retryable failure.
 * A wrongly-preserved session costs one confusing error; a wrongly-destroyed one costs a re-login.
 */
export function isRejectedGrantDiscordError(error: unknown): boolean {
	return error instanceof DiscordAPIError && error.code === 'invalid_grant';
}

/**
 * Whether `error` is discord reporting the requested resource doesn't exist -- distinct from unauthorized above:
 * this is discord saying "there's no such user/guild/member", not "your credential is bad". Callers use this to
 * tell "the guild kicked the bot or the member left between mint and use" apart from a genuine outage.
 */
export function isNotFoundDiscordError(error: unknown): boolean {
	return error instanceof DiscordAPIError && error.status === 404;
}
