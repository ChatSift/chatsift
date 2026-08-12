import { z } from 'zod';
import { httpUrlSchema, snowflakeSchema } from '../../util/schemas.js';

/**
 * Browser-safe: only `zod` + the pure `snowflakeSchema` regex, nothing server-only. Exposed to `apps/website`
 * via the `@chatsift/api/social-schemas` package export (see `package.json`), mirroring `ama/schemas.ts` and
 * `modmail/schemas.ts`, so the dashboard (#343 P4) validates against the exact same rules the API enforces.
 *
 * Where a bound below is marked "legacy", it's the one `ChatSift/Social`'s slash-command option definitions
 * enforced (captured in docs/roadmap/10-social-port.md's feature catalog) -- legacy never had these as DB
 * constraints, so they only ever applied to writes, which is exactly what this layer is. The schema keeps only
 * the constraints bad data would genuinely break (see schema.sql's Social section), deliberately leaving these
 * to zod so a legacy row that predates a bound still migrates rather than failing an INSERT.
 */

/**
 * Mirrors `CREATE TYPE social_level_up_notification_mode` in packages/private/db/schema/schema.sql. A literal
 * tuple rather than something derived from the generated enum, for the same reason `ama/constants.ts` spells
 * `QUESTION_STATES` out: `@chatsift/db` re-exports kanel's enum as a *type* only, so there's no runtime value
 * to iterate -- and this file has to stay browser-safe regardless.
 *
 * 'NONE' disables notifications, 'DM' messages the user directly, 'CHANNEL' posts in the channel they levelled
 * up in (falling back to `levelUpNotificationFallbackChannelId`).
 */
export const LEVEL_UP_NOTIFICATION_MODES = ['NONE', 'DM', 'CHANNEL'] as const;

// Postgres `integer` ceiling -- an out-of-range value 400s here instead of erroring at the INSERT (same
// reasoning as modmail's `maxConcurrentThreads`).
const INT4_MAX = 2_147_483_647;

export const updateSocialConfigBodySchema = z
	.strictObject({
		// The three "is this guild configured at all" fields: the bot stays fully inert until all three are
		// set (see schema.sql). Nullable so the dashboard can clear them back to that inert state, which is a
		// real thing to want -- it's how a guild turns levelling off without losing everyone's XP.
		requiredMessages: z.number().int().min(1).max(15).nullable().optional(), // legacy: 1-15
		requiredMessagesTimespan: z.number().int().min(1).max(60).nullable().optional(), // legacy: 1-60 seconds
		xpGain: z.number().int().min(1).max(INT4_MAX).nullable().optional(), // legacy: >= 1, no upper bound
		// XP curve (`required_xp_base + required_xp_multiplier * n(n-1)/2`). Both minimums are also DB CHECKs,
		// since a 0 in either makes the level walk non-terminating -- the bounds here are the legacy maximums.
		requiredXpBase: z.number().int().min(1).max(500).nullable().optional(), // legacy: 1-500
		requiredXpMultiplier: z.number().int().min(1).max(100).nullable().optional(), // legacy: 1-100
		levelUpNotificationMode: z.enum(LEVEL_UP_NOTIFICATION_MODES).optional(),
		// Where a 'CHANNEL' notification goes when the channel the user levelled up in can't be posted in.
		// `updateConfig.ts` additionally rejects a channel this bot can't post in at all (a category, a forum).
		levelUpNotificationFallbackChannelId: snowflakeSchema.nullable().optional(),
		// Supports `{{ username }}`, `{{ level }}`, `{{ guildName }}` and `{{ earnedRewards }}`. `null` means
		// "use the built-in default", which is why clearing it is distinct from setting it to an empty string
		// (rejected by `.min(1)`) -- an empty notification message would post nothing at all.
		levelUpNotificationMessage: z.string().min(1).max(2_000).nullable().optional(),
		// Opt-in for the unauthenticated `/leaderboard/:guildId` page. A plain boolean rather than a share
		// token (see schema.sql for why): one leaderboard per guild, already keyed by the guild id the page
		// puts in its own URL, so there is nothing an unguessable identifier would protect.
		publicLeaderboard: z.boolean().optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

/**
 * Every row of a leaderboard page costs one `GET /users/{id}` on a cold cache, and that endpoint sits in a
 * 30-per-30s per-token bucket `@discordjs/rest` serializes against (see `util/users.ts`). 50 is already two
 * pages' worth of that budget; anything larger turns a single page view into a visibly stalled request.
 */
const LEADERBOARD_MAX_PAGE_SIZE = 50;
const LEADERBOARD_DEFAULT_PAGE_SIZE = 25;
const LEADERBOARD_MAX_OFFSET = 100_000;

/**
 * Offset/limit rather than the cursor pagination `createPaginationQuerySchema` establishes for
 * `modmail/threads`. That convention exists because those lists order by an identity primary key, where an
 * offset drifts under concurrent inserts -- neither half applies here. A leaderboard orders by a mutable
 * `xp`, which no cursor could page stably anyway, and its whole content is *rank*: a rank is `offset + n`,
 * so paging by offset is the only thing that computes one without re-counting the guild per row.
 *
 * Lives in this file rather than beside the routes so it stays free of server-only imports, which is what
 * lets it be unit-tested alongside the rest of Social's bounds.
 */
export const leaderboardQuerySchema = z.object({
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(LEADERBOARD_MAX_PAGE_SIZE)
		.optional()
		.default(LEADERBOARD_DEFAULT_PAGE_SIZE),
	offset: z.coerce.number().int().min(0).max(LEADERBOARD_MAX_OFFSET).optional().default(0),
});

/**
 * Channel and role rows are full-representation PUTs, not partial patches: the body below *is* the row's
 * complete configurable state, so an omitted field resets to its default rather than being left alone. The
 * dashboard's editor submits both fields together, and legacy's per-field commands (`/channel ignore`,
 * `/channel set-multiplier`) are gone with the rest of the config commands (redesign ledger item 1) -- so
 * there's no caller that needs "change only this field" semantics, and this way a row can never end up in a
 * state no single request described.
 */
export const upsertSocialChannelBodySchema = z.strictObject({
	// Silences the channel entirely -- resolved against the message's channel, its parent category, or (for a
	// thread) the thread parent's parent, so one row can silence a whole category.
	ignored: z.boolean().default(false),
	// Multiplies `xpGain` for messages resolved to this channel. legacy: 1-10.
	multiplier: z.number().int().min(1).max(10).default(1),
});

export const upsertSocialRoleBodySchema = z.strictObject({
	// Stacks multiplicatively across every configured role the member holds, on top of the channel multiplier.
	// Legacy's own bound here is unknown (the doc's catalog doesn't record one and the repo isn't checked out),
	// so this is a deliberately generous sanity cap rather than a claimed parity bound -- it has to stay wide
	// enough that it can't reject a value migrated out of legacy and then block unrelated edits to the row.
	multiplier: z.number().int().min(1).max(1_000).default(1),
});

export const upsertSocialRewardBodySchema = z.strictObject({
	// Same "legacy bound unknown" caveat as the role multiplier above. 1_000 is already unreachable in
	// practice: at the maximum curve (base 500, multiplier 100) level 1000 costs ~50M XP.
	level: z.number().int().min(1).max(1_000),
	// A "clean"/tiered reward: only the highest one at or below the member's level is held, so a new tier
	// replaces the previous one instead of stacking. Non-clean rewards accumulate.
	clean: z.boolean().default(false),
});

// Discord's own rule for a `CHAT_INPUT` command name: lowercase, no spaces. Enforced here so a bad name is a
// 400 from us with a useful message rather than a 400 from Discord surfaced as a generic 422 at registration
// time. Deliberately narrower than Discord's full unicode-aware pattern (which allows non-latin scripts) --
// the dashboard's own field can be widened later if anyone actually asks.
const INTERACTION_NAME_REGEX = /^[\d_a-z-]{1,32}$/;

const interactionFields = {
	// Doubles as the Discord command name (an interaction named `hug` is invoked as `/hug`), hence the
	// guild-wide uniqueness the API enforces via `social_interactions_guild_id_name_key`.
	name: z.string().regex(INTERACTION_NAME_REGEX, 'Must be 1-32 lowercase characters, digits, dashes or underscores'),
	// Templated with `{{ author }}` and `{{ targets }}` (the latter only meaningful when `allowTargets`).
	content: z.string().min(1).max(2_000),
	// Embed accent color as a `#rrggbb` string -- kept as the string legacy stored rather than reinterpreted
	// as the integer Discord wants (see schema.sql). Only meaningful when `embed` is on.
	color: z
		.string()
		.regex(/^#[\da-f]{6}$/i, 'Must be a hex color like #7289da')
		.nullable()
		.optional(),
	// Sent alongside the embed, outside it, when `embed` is on.
	plainContent: z.string().min(1).max(2_000).nullable().optional(),
	// Rendered as the embed's image -- the same shared `image.url` rule modmail's snippet/panel attachments
	// use (see `util/schemas.ts`).
	attachmentUrl: httpUrlSchema.nullable().optional(),
	embed: z.boolean(),
	// Whether the generated command takes user-mention options, which render into `{{ targets }}`.
	allowTargets: z.boolean(),
};

export const createSocialInteractionBodySchema = z.strictObject({
	...interactionFields,
	embed: interactionFields.embed.default(false),
	allowTargets: interactionFields.allowTargets.default(false),
});

// Plain field shape reused via `.partial()` rather than `.partial()` on the create schema -- zod v4 keeps a
// `.default()` live through `.partial()`, so sharing the create variant would make every PATCH that omits
// `embed`/`allowTargets` silently reset them to false. Same trap `modmail/schemas.ts`'s `categoryFields`
// documents.
export const updateSocialInteractionBodySchema = z
	.strictObject(interactionFields)
	.partial()
	.refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');
