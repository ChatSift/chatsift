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

/**
 * AutoModerator's guild-wide config channel (docs/roadmap/11-automoderator-port.md).
 *
 * Guild-scoped and nothing finer at P0, because there is one settings row. The phases that add cases, reports
 * and filter logs each want their own channel rather than widening this one -- a case browser refetching
 * because someone toggled dry-run is exactly the over-invalidation the per-domain naming exists to avoid.
 */
export function automoderatorConfigChannel(guildId: string): string {
	return `automoderator:${guildId}:config`;
}

/**
 * The case browser's channel (P1). Separate from the config channel per the note above: a case list refetching
 * because someone toggled dry-run is exactly the over-invalidation this naming exists to avoid.
 *
 * Guild-wide rather than per-case, because the list is the thing that goes stale -- a new case appears at the
 * top of it, and an amended case changes a row in it. A watcher sitting on one case detail refetching when an
 * unrelated case is filed is a cheap request; a case browser that silently misses new cases is a wrong screen.
 */
export function automoderatorCasesChannel(guildId: string): string {
	return `automoderator:${guildId}:cases`;
}

/**
 * Log channel configuration (P1), which the case browser doesn't care about and vice versa.
 */
export function automoderatorLogChannelsChannel(guildId: string): string {
	return `automoderator:${guildId}:log-channels`;
}

/**
 * The report queue (P3). Published by the *bot* far more often than by the API: reports originate in Discord --
 * a member using a context menu, or a moderator dismissing a card -- so without the bot broadcasting here the
 * dashboard queue would only ever learn about them on a manual reload. Same direction as
 * `automoderatorCasesChannel`, and for the same reason.
 */
export function automoderatorReportsChannel(guildId: string): string {
	return `automoderator:${guildId}:reports`;
}

/**
 * Report reason presets (P3). Its own channel rather than riding the config one: the preset editor and the
 * enforcement toggle are different screens, and neither should refetch because the other changed.
 */
export function automoderatorReportPresetsChannel(guildId: string): string {
	return `automoderator:${guildId}:report-presets`;
}

/**
 * The warn ladder's rungs (P2). Only the API ever publishes here -- the bot reads the ladder but never edits it,
 * unlike cases and reports, which originate in Discord.
 */
export function automoderatorWarnPunishmentsChannel(guildId: string): string {
	return `automoderator:${guildId}:warn-punishments`;
}

/**
 * Log exemptions (P4, feature 35). Separate from `automoderatorLogChannelsChannel` even though the two sit on
 * neighbouring screens: the exemption list is edited a row at a time and the log channels a webhook at a time,
 * so sharing one channel would make every "add a channel to the ignore list" click refetch three webhook rows
 * for nothing.
 */
export function automoderatorLogExemptionsChannel(guildId: string): string {
	return `automoderator:${guildId}:log-exemptions`;
}

/**
 * Banword policies (P5, feature 01). Only the API publishes here -- the bot reads policies on every native
 * AutoMod hit but never writes one.
 */
export function automoderatorBanwordPoliciesChannel(guildId: string): string {
	return `automoderator:${guildId}:banword-policies`;
}

/**
 * Filter bypass roles (P5, feature 10). Its own channel rather than riding the config one for the same reason
 * every other list here has one: the bypass editor and the enforcement toggles are different screens.
 */
export function automoderatorBypassRolesChannel(guildId: string): string {
	return `automoderator:${guildId}:bypass-roles`;
}
