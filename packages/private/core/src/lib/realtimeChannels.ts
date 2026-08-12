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

/**
 * The Social leaderboard's channel -- guild-scoped and nothing finer, since the whole page is one ranked list
 * and there's no sub-resource to watch separately.
 *
 * The one channel **both** of its audiences subscribe to: the dashboard page
 * (`/dashboard/:guildId/social/leaderboard`) through the gateway's guild-manager path, and the public page
 * (`/leaderboard/:guildId`) through its ticket's explicit `channels` allowlist, which is the whole of what
 * that ticket authorizes. Unlike AMA, the public surface here needs no channel of its own: it's keyed by the
 * same guild id it already displays in its own URL, so there is no snowflake to keep out of the string.
 *
 * Signals come from `services/social-bot` (every XP grant is a Postgres write the API never sees), throttled
 * there rather than here -- see its `leaderboardBroadcast.ts` -- and from the config route, since the curve
 * decides what level every listed member is shown at.
 */
export function socialLeaderboardChannel(guildId: string): string {
	return `social:${guildId}:leaderboard`;
}
