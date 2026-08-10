/**
 * Channel-name builders for the WebSocket gateway (`services/api/src/ws`). A channel is an opaque string
 * both sides agree on -- built here once so the API (broadcasting) and the dashboard (subscribing) can never
 * drift out of sync on the exact string, the same "one source of truth" reasoning as the route contracts
 * (docs/adr/0001-api-contract-pattern.md).
 *
 * Default format is `<domain>:<guildId>:<...>` -- the gateway's guild-wide authorization path reads the second
 * colon-segment as a guild id (see `services/api/src/ws/authorizeChannel.ts`), so any builder meant to be
 * reachable by "whoever manages this guild" must keep that shape.
 *
 * `amaPublicAnswersChannel` is the one deliberate exception, see its own doc comment.
 */
export function amaQuestionsChannel(guildId: string, amaId: number | string): string {
	return `ama-questions:${guildId}:${amaId}`;
}

/**
 * The public answers page's channel (`/ama-answers/[shareToken]`, `routes/ama/questions/publicAnswers.ts`).
 *
 * Deliberately carries **no guild id**, breaking the shape above: that page is unauthenticated and hides every
 * raw Discord id it can (see `publicAnswers.ts`'s `toPublicUserInfo`), so putting a guild snowflake in a string
 * handed to an anonymous browser would undo that for no gain. The practical consequence is that this domain is
 * only ever reachable through a ticket's explicit `channels` allowlist (minted by
 * `routes/ama/questions/publicWsTicket.ts` against a valid share token) and never through the guild-manager
 * path -- which is fine, since managers watch `amaQuestionsChannel` instead.
 *
 * The ama id being guessable doesn't leak anything on its own: gateway messages are a bare
 * `{ type: 'invalidate' }` with no payload, and subscribing at all still requires a valid share token.
 */
export function amaPublicAnswersChannel(amaId: number | string): string {
	return `ama-public:${amaId}`;
}
