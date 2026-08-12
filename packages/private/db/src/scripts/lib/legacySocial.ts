// Shared legacy-Social reading and mapping, used by both `migrateLegacySocial.ts` (the #343 P5 cutover
// migration) and `copyLegacySocialGuild.ts` (the one-guild sandbox copy). See
// docs/roadmap/10-social-port.md for the milestone context and schema.sql's Social section for the four
// deliberate deviations from the legacy schema, every one of which is encoded here.
//
// The two scripts exist separately because their *safety* models are opposites -- the migration refuses to
// touch anything twice and never rewrites a guild id, while the sandbox copy deletes its target guild's
// rows and rewrites every guild id it writes. Neither of those flags belongs on the other script. But the
// legacy-to-new column mapping is identical, and a second copy of it is a second thing to keep in sync with
// schema.sql, so it lives here once and both entrypoints call it.

import process from 'node:process';
import type postgres from 'postgres';
import type { Database } from '../../index.js';

/**
 * The common supertype of the top-level client (`Database`) and a `sql.begin` transaction handle --
 * everything below only ever queries and builds fragments, so it accepts either rather than forcing every
 * helper to know which one it was handed.
 */
export type Executor = postgres.ISql;

// Big enough that the round-trip count stays trivial, small enough that a single INSERT's parameter list
// stays well clear of Postgres' 65535-parameter ceiling (the widest table here binds 10 columns per row).
// `social_users` is the only table with unknown magnitude -- nobody has counted it -- so it is the one this
// actually matters for.
export const BATCH_SIZE = 1_000;

/**
 * Thrown to unwind out of `sql.begin` once a `--dry-run` has finished, so postgres.js issues a ROLLBACK
 * instead of a COMMIT. Caught and swallowed by the caller -- it is not a failure.
 */
export class RollbackSignal extends Error {
	public constructor() {
		super('dry run complete, rolling back');
		this.name = 'RollbackSignal';
	}
}

/**
 * Legacy row shapes, from `ChatSift/Social`'s `prisma/schema.prisma`. Every query below aliases the legacy
 * quoted-camelCase columns to snake_case so the `postgres.camel` transform `createDb` applies hands them
 * back as camelCase -- the aliases double as an explicit, reviewable statement of the old-to-new column
 * mapping.
 *
 * Note there is not a single timestamp anywhere in the legacy Social schema, so none of the timezone
 * handling `migrateLegacyModmail.ts` needs applies here.
 */
export interface LegacyGuildSettings {
	guildId: string;
	levelUpNotificationFallbackChannelId: string | null;
	levelUpNotificationMessage: string | null;
	levelUpNotificationMode: string;
	requiredMessages: number | null;
	requiredMessagesTimespan: number | null;
	requiredXpBase: number | null;
	requiredXpMultiplier: number | null;
	xpGain: number | null;
}

export interface LegacyUser {
	guildId: string;
	ignored: boolean;
	userId: string;
	xp: number;
}

export interface LegacyChannel {
	channelId: string;
	guildId: string;
	ignored: boolean;
	multiplier: number | null;
}

export interface LegacyRole {
	guildId: string;
	multiplier: number | null;
	roleId: string;
}

export interface LegacyReward {
	clean: boolean;
	guildId: string;
	level: number;
	roleId: string;
}

export interface LegacySocialInteraction {
	allowTargets: boolean;
	attachmentUrl: string | null;
	color: string | null;
	content: string;
	embed: boolean;
	guildId: string;
	name: string;
	plainContent: string | null;
	uses: number;
}

export interface TableStat {
	inserted: number;
	read: number;
	skipped: number;
}

export type Stats = Record<string, TableStat>;

export function statFor(read: number, inserted: number): TableStat {
	return { read, inserted, skipped: read - inserted };
}

export function chunk<TItem>(items: readonly TItem[], size: number): TItem[][] {
	const out: TItem[][] = [];
	for (let index = 0; index < items.length; index += size) {
		out.push(items.slice(index, index + size));
	}

	return out;
}

/**
 * Deviation 1: legacy's `LevelUpNotificationMode` labels are uppercased to match this schema's other enum
 * (`ama_question_state`). Written out rather than done with `.toUpperCase()` so an unrecognized label --
 * which would mean the legacy schema drifted from what docs/roadmap/10-social-port.md captured -- fails
 * loudly here instead of being handed to Postgres as an invalid enum value mid-transaction.
 */
const LEVEL_UP_MODE_MAP: Record<string, string> = {
	None: 'NONE',
	DM: 'DM',
	Channel: 'CHANNEL',
};

export const LEGACY_LEVEL_UP_MODES = Object.keys(LEVEL_UP_MODE_MAP);

function mapLevelUpMode(legacyMode: string): string {
	const mapped = LEVEL_UP_MODE_MAP[legacyMode];
	if (mapped === undefined) {
		throw new Error(
			`unrecognized legacy LevelUpNotificationMode ${JSON.stringify(legacyMode)} — expected one of ` +
				`${LEGACY_LEVEL_UP_MODES.join(', ')}. The legacy schema has drifted from what this script was written against.`,
		);
	}

	return mapped;
}

export interface CopyOptions {
	/**
	 * Write rows under this guild id instead of the one they carry in the legacy database. Only meaningful
	 * alongside `onlyGuildId` -- remapping every guild in a multi-guild database onto one id would collide
	 * on every natural primary key. `copyLegacySocialGuild.ts` is the only caller that sets it.
	 */
	asGuildId?: string | undefined;
	/**
	 * Restrict every read to this legacy guild. `undefined` migrates the whole database, which is what the
	 * cutover wants.
	 */
	onlyGuildId?: string | undefined;
}

/**
 * A postgres.js fragment that is either a guild filter or nothing at all, so each read below can be written
 * once rather than twice. An empty tagged template renders as the empty string, which is what makes the
 * unfiltered case a plain `SELECT ... FROM x` again.
 */
function guildFilter(legacy: Database, { onlyGuildId }: CopyOptions): postgres.PendingQuery<postgres.Row[]> {
	return onlyGuildId === undefined ? legacy`` : legacy`WHERE "guildId" = ${onlyGuildId}`;
}

/**
 * The guild id a row is written under: its own, unless the caller asked for a remap.
 */
function guildIdFor(row: { guildId: string }, { asGuildId }: CopyOptions): string {
	return asGuildId ?? row.guildId;
}

export async function copyGuildSettings(legacy: Database, tx: Executor, options: CopyOptions): Promise<TableStat> {
	const rows = await legacy<LegacyGuildSettings[]>`
		SELECT
			"guildId"                              AS guild_id,
			"requiredMessages"                     AS required_messages,
			"requiredMessagesTimespan"             AS required_messages_timespan,
			"xpGain"                               AS xp_gain,
			"requiredXpBase"                       AS required_xp_base,
			"requiredXpMultiplier"                 AS required_xp_multiplier,
			"levelUpNotificationMode"::text        AS level_up_notification_mode,
			"levelUpNotificationFallbackChannelId" AS level_up_notification_fallback_channel_id,
			"levelUpNotificationMessage"           AS level_up_notification_message
		FROM "GuildSettings" ${guildFilter(legacy, options)}
		ORDER BY "guildId"
	`;

	// `public_leaderboard` is deliberately absent from the column list: it is new surface with no legacy
	// counterpart (redesign ledger item 5), and its `false` default is the only correct migrated value --
	// everything the page shows is member activity data, so nobody gets opted in by a migration.
	const values = rows.map((row) => ({
		guildId: guildIdFor(row, options),
		requiredMessages: row.requiredMessages,
		requiredMessagesTimespan: row.requiredMessagesTimespan,
		xpGain: row.xpGain,
		requiredXpBase: row.requiredXpBase,
		requiredXpMultiplier: row.requiredXpMultiplier,
		levelUpNotificationMode: mapLevelUpMode(row.levelUpNotificationMode),
		levelUpNotificationFallbackChannelId: row.levelUpNotificationFallbackChannelId,
		levelUpNotificationMessage: row.levelUpNotificationMessage,
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO social_guild_settings ${tx(
				batch,
				'guildId',
				'requiredMessages',
				'requiredMessagesTimespan',
				'xpGain',
				'requiredXpBase',
				'requiredXpMultiplier',
				'levelUpNotificationMode',
				'levelUpNotificationFallbackChannelId',
				'levelUpNotificationMessage',
			)}
			ON CONFLICT (guild_id) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

export async function copyUsers(legacy: Database, tx: Executor, options: CopyOptions): Promise<TableStat> {
	// The only table here with unknown magnitude, and the one the cutover's wall-clock estimate hinges on.
	// Read whole rather than cursored: `migrateLegacyModmail.ts` reads `ThreadMessage` the same way, and a
	// per-guild XP ledger is bounded by member count -- an order of magnitude short of anything that would
	// need streaming.
	const rows = await legacy<LegacyUser[]>`
		SELECT
			"guildId" AS guild_id,
			"userId"  AS user_id,
			"xp"      AS xp,
			"ignored" AS ignored
		FROM "User" ${guildFilter(legacy, options)}
		ORDER BY "guildId", "userId"
	`;

	const values = rows.map((row) => ({
		guildId: guildIdFor(row, options),
		userId: row.userId,
		xp: row.xp,
		ignored: row.ignored,
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ userId: string }[]>`
			INSERT INTO social_users ${tx(batch, 'guildId', 'userId', 'xp', 'ignored')}
			ON CONFLICT (guild_id, user_id) DO NOTHING
			RETURNING user_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

export async function copyChannels(legacy: Database, tx: Executor, options: CopyOptions): Promise<TableStat> {
	const rows = await legacy<LegacyChannel[]>`
		SELECT
			"guildId"    AS guild_id,
			"channelId"  AS channel_id,
			"ignored"    AS ignored,
			"multiplier" AS multiplier
		FROM "Channel" ${guildFilter(legacy, options)}
		ORDER BY "guildId", "channelId"
	`;

	// Deviation 2: legacy's `Int? @default(1)` was nullable, but a NULL there meant exactly 1 -- every read
	// site did `multiplier ?? 1` -- so coalescing changes nothing semantically.
	const values = rows.map((row) => ({
		guildId: guildIdFor(row, options),
		channelId: row.channelId,
		ignored: row.ignored,
		multiplier: row.multiplier ?? 1,
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ channelId: string }[]>`
			INSERT INTO social_channels ${tx(batch, 'guildId', 'channelId', 'ignored', 'multiplier')}
			ON CONFLICT (guild_id, channel_id) DO NOTHING
			RETURNING channel_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

export async function copyRoles(legacy: Database, tx: Executor, options: CopyOptions): Promise<TableStat> {
	const rows = await legacy<LegacyRole[]>`
		SELECT
			"guildId"    AS guild_id,
			"roleId"     AS role_id,
			"multiplier" AS multiplier
		FROM "Role" ${guildFilter(legacy, options)}
		ORDER BY "guildId", "roleId"
	`;

	// Deviation 2 again, same reasoning as `social_channels.multiplier`.
	const values = rows.map((row) => ({
		guildId: guildIdFor(row, options),
		roleId: row.roleId,
		multiplier: row.multiplier ?? 1,
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ roleId: string }[]>`
			INSERT INTO social_roles ${tx(batch, 'guildId', 'roleId', 'multiplier')}
			ON CONFLICT (guild_id, role_id) DO NOTHING
			RETURNING role_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

export async function copyRewards(legacy: Database, tx: Executor, options: CopyOptions): Promise<TableStat> {
	const rows = await legacy<LegacyReward[]>`
		SELECT
			"guildId" AS guild_id,
			"roleId"  AS role_id,
			"level"   AS level,
			"clean"   AS clean
		FROM "Reward" ${guildFilter(legacy, options)}
		ORDER BY "guildId", "roleId"
	`;

	const values = rows.map((row) => ({
		guildId: guildIdFor(row, options),
		roleId: row.roleId,
		level: row.level,
		clean: row.clean,
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ roleId: string }[]>`
			INSERT INTO social_rewards ${tx(batch, 'guildId', 'roleId', 'level', 'clean')}
			ON CONFLICT (guild_id, role_id) DO NOTHING
			RETURNING role_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

export async function copyInteractions(legacy: Database, tx: Executor, options: CopyOptions): Promise<TableStat> {
	const rows = await legacy<LegacySocialInteraction[]>`
		SELECT
			"guildId"       AS guild_id,
			"name"          AS name,
			"content"       AS content,
			"color"         AS color,
			"plainContent"  AS plain_content,
			"attachmentUrl" AS attachment_url,
			"uses"          AS uses,
			"embed"         AS embed,
			"allowTargets"  AS allow_targets
		FROM "SocialInteraction" ${guildFilter(legacy, options)}
		ORDER BY "guildId", "name"
	`;

	// Two columns are deliberately absent from both the read and the write:
	//
	// `commandId` (deviation 3): a Discord command id belongs to an *application*, so every legacy id 404s
	// under the new bot's application whether or not the cutover mints a new one. The column stays NULL and
	// the resync assigns real ids -- redesign ledger item 3, and the exact lesson ModMail's snippets taught.
	// Dispatch tolerates the NULL meanwhile by falling back to a `(guild_id, name)` lookup.
	//
	// `id`: the surrogate PK is `GENERATED BY DEFAULT AS IDENTITY` and nothing references it (unlike
	// `migrateLegacyModmail.ts`'s snippets, whose ids parent `snippet_updates`), so letting the sequence fill
	// it is both correct and one less thing to reserve up front.
	const values = rows.map((row) => ({
		guildId: guildIdFor(row, options),
		name: row.name,
		content: row.content,
		color: row.color,
		plainContent: row.plainContent,
		attachmentUrl: row.attachmentUrl,
		uses: row.uses,
		embed: row.embed,
		allowTargets: row.allowTargets,
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ id: number }[]>`
			INSERT INTO social_interactions ${tx(
				batch,
				'guildId',
				'name',
				'content',
				'color',
				'plainContent',
				'attachmentUrl',
				'uses',
				'embed',
				'allowTargets',
			)}
			ON CONFLICT (guild_id, name) DO NOTHING
			RETURNING id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

/**
 * Every table, in an order chosen for legibility rather than necessity -- the six Social tables have no
 * foreign keys between them, so nothing here depends on anything else having landed first.
 */
export async function copyAll(legacy: Database, tx: Executor, options: CopyOptions): Promise<Stats> {
	return {
		social_guild_settings: await copyGuildSettings(legacy, tx, options),
		social_users: await copyUsers(legacy, tx, options),
		social_channels: await copyChannels(legacy, tx, options),
		social_roles: await copyRoles(legacy, tx, options),
		social_rewards: await copyRewards(legacy, tx, options),
		social_interactions: await copyInteractions(legacy, tx, options),
	};
}

/**
 * Every guild id appearing anywhere in the legacy database. A guild can have XP rows without settings (the
 * legacy bot only wrote `GuildSettings` when someone ran `/config`), so this has to be the union of all six
 * tables rather than just the settings one.
 */
export async function collectLegacyGuildIds(legacy: Database): Promise<string[]> {
	const rows = await legacy<{ guildId: string }[]>`
		SELECT "guildId" AS guild_id FROM "GuildSettings"
		UNION SELECT "guildId" AS guild_id FROM "User"
		UNION SELECT "guildId" AS guild_id FROM "Channel"
		UNION SELECT "guildId" AS guild_id FROM "Role"
		UNION SELECT "guildId" AS guild_id FROM "Reward"
		UNION SELECT "guildId" AS guild_id FROM "SocialInteraction"
		ORDER BY 1
	`;

	return rows.map((row) => row.guildId);
}

/**
 * Legacy rows that the target's CHECK constraints would reject, collected as printable strings.
 *
 * schema.sql deliberately carries only the CHECKs "a bad value would actually break something with", but
 * legacy enforced its bounds solely in slash-command option definitions -- so they were only ever true of
 * writes made through the current version of the bot, never of the data at rest. Catching these up front
 * turns an opaque mid-transaction constraint violation into a list of guilds an operator can go fix.
 */
export async function findConstraintViolations(legacy: Database, options: CopyOptions): Promise<string[]> {
	const problems: string[] = [];

	// A base or multiplier of 0 makes the level walk's requirement stop growing, so the derivation never
	// terminates -- the bot hangs rather than misbehaves. See the CHECK's comment in schema.sql.
	//
	// The parentheses around the OR are load-bearing. AND binds tighter, so without them appending the guild
	// filter would group as "base < 1 OR (multiplier < 1 AND guildId = ...)" -- reporting violations from
	// every *other* guild, and aborting a single-guild copy over data it was never going to touch. This is
	// the only predicate in this function with an OR in it; the four below are single conditions.
	const badCurves = await legacy<
		{ guildId: string; requiredXpBase: number | null; requiredXpMultiplier: number | null }[]
	>`
		SELECT "guildId" AS guild_id, "requiredXpBase" AS required_xp_base, "requiredXpMultiplier" AS required_xp_multiplier
		FROM "GuildSettings"
		WHERE ("requiredXpBase" < 1 OR "requiredXpMultiplier" < 1)
		${options.onlyGuildId === undefined ? legacy`` : legacy`AND "guildId" = ${options.onlyGuildId}`}
		ORDER BY "guildId"
	`;

	for (const row of badCurves) {
		problems.push(
			`guild ${row.guildId} has an XP curve the target rejects (base=${row.requiredXpBase}, ` +
				`multiplier=${row.requiredXpMultiplier}); both must be >= 1 or NULL, and a 0 would hang level derivation`,
		);
	}

	const badChannels = await legacy<{ channelId: string; guildId: string; multiplier: number }[]>`
		SELECT "guildId" AS guild_id, "channelId" AS channel_id, "multiplier" AS multiplier
		FROM "Channel"
		WHERE "multiplier" < 1
		${options.onlyGuildId === undefined ? legacy`` : legacy`AND "guildId" = ${options.onlyGuildId}`}
		ORDER BY "guildId", "channelId"
	`;

	for (const row of badChannels) {
		problems.push(`channel ${row.guildId}/${row.channelId} has multiplier ${row.multiplier}; must be >= 1`);
	}

	const badRoles = await legacy<{ guildId: string; multiplier: number; roleId: string }[]>`
		SELECT "guildId" AS guild_id, "roleId" AS role_id, "multiplier" AS multiplier
		FROM "Role"
		WHERE "multiplier" < 1
		${options.onlyGuildId === undefined ? legacy`` : legacy`AND "guildId" = ${options.onlyGuildId}`}
		ORDER BY "guildId", "roleId"
	`;

	for (const row of badRoles) {
		problems.push(`role ${row.guildId}/${row.roleId} has multiplier ${row.multiplier}; must be >= 1`);
	}

	const badRewards = await legacy<{ guildId: string; level: number; roleId: string }[]>`
		SELECT "guildId" AS guild_id, "roleId" AS role_id, "level" AS level
		FROM "Reward"
		WHERE "level" < 0
		${options.onlyGuildId === undefined ? legacy`` : legacy`AND "guildId" = ${options.onlyGuildId}`}
		ORDER BY "guildId", "roleId"
	`;

	for (const row of badRewards) {
		problems.push(`reward ${row.guildId}/${row.roleId} is for level ${row.level}; must be >= 0`);
	}

	// Cheap schema-drift canary: a label outside the three captured in docs/roadmap/10-social-port.md means
	// `mapLevelUpMode` would throw mid-run, which is a worse place to find out.
	const badModes = await legacy<{ guildId: string; levelUpNotificationMode: string }[]>`
		SELECT "guildId" AS guild_id, "levelUpNotificationMode"::text AS level_up_notification_mode
		FROM "GuildSettings"
		WHERE "levelUpNotificationMode"::text <> ALL(${LEGACY_LEVEL_UP_MODES})
		${options.onlyGuildId === undefined ? legacy`` : legacy`AND "guildId" = ${options.onlyGuildId}`}
		ORDER BY "guildId"
	`;

	for (const row of badModes) {
		problems.push(
			`guild ${row.guildId} has level-up mode '${row.levelUpNotificationMode}', which this script has no mapping ` +
				`for — the legacy schema has drifted`,
		);
	}

	return problems;
}

export function printStats(stats: Stats): void {
	console.log('\nTable                       read  inserted  skipped');
	for (const [table, stat] of Object.entries(stats)) {
		console.log(
			`  ${table.padEnd(26)}${String(stat.read).padStart(4)}${String(stat.inserted).padStart(10)}${String(stat.skipped).padStart(9)}`,
		);
	}
}

// Destructured rather than accessed key-by-key: `ProcessEnv` is an index signature, so
// `noPropertyAccessFromIndexSignature` rejects dot access while eslint's `dot-notation` rejects bracket
// access. Destructuring is the one form both are happy with.
const { IS_PRODUCTION, DATABASE_URL_DEV, DATABASE_URL_PROD, LEGACY_DATABASE_URL } = process.env;

// The exact sets `zod`'s `stringbool()` uses, which is what parses IS_PRODUCTION in
// `@chatsift/backend-core`'s shared env schema. Duplicated rather than imported because these scripts
// deliberately don't pull in backend-core (that schema is a top-level `.parse(process.env)` evaluated on
// import by every service, so adding LEGACY_DATABASE_URL to it would break all of them for the sake of a
// script none of them run) -- but it has to agree with it *exactly*: a script picking a different database
// than the rest of the stack, while `--live` commits real inserts, is the worst way for it to be wrong.
const TRUTHY = new Set(['true', '1', 'yes', 'on', 'y', 'enabled']);
const FALSY = new Set(['false', '0', 'no', 'off', 'n', 'disabled']);

export function resolveTargetUrl(): string {
	// `envSchema` declares IS_PRODUCTION as `.default(false)`, so unset means dev -- but an unrecognized
	// value is an error there, not a silent falsy. Match that: quietly treating `IS_PRODUCTION=maybe` as dev
	// would point a `--live` run at DATABASE_URL_DEV while the rest of the stack ran on prod config.
	const raw = (IS_PRODUCTION ?? 'false').toLowerCase();
	if (!TRUTHY.has(raw) && !FALSY.has(raw)) {
		console.error(
			`IS_PRODUCTION is set to ${JSON.stringify(IS_PRODUCTION)}, which is not a recognized boolean — expected one ` +
				`of ${[...TRUTHY, ...FALSY].join(', ')}. Refusing to guess which database to target.`,
		);
		process.exit(1);
	}

	const isProduction = TRUTHY.has(raw);
	const url = isProduction ? DATABASE_URL_PROD : DATABASE_URL_DEV;

	if (!url) {
		console.error(`${isProduction ? 'DATABASE_URL_PROD' : 'DATABASE_URL_DEV'} is not set`);
		process.exit(1);
	}

	return url;
}

export function resolveLegacyUrl(): string {
	if (!LEGACY_DATABASE_URL) {
		console.error(
			'LEGACY_DATABASE_URL is required — point it at a restored copy of the ChatSift/Social database, never the ' +
				'live one (these scripts hold one transaction open across reads of the legacy side)',
		);
		process.exit(1);
	}

	return LEGACY_DATABASE_URL;
}

/**
 * Snowflake shape, used to validate the `--from`/`--to` guild ids the sandbox copy takes. Deliberately not
 * a range check -- anything that is a run of digits is a plausible id, and the script's real safety comes
 * from `--dry-run` showing exactly what it would delete and write.
 */
export const SNOWFLAKE_PATTERN = /^\d{17,20}$/u;
