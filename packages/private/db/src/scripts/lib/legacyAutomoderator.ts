// The legacy-AutoModerator to v3 column mapping, read by `migrateLegacyAutomoderator.ts` (the #11 P9 cutover
// migration). See docs/roadmap/11-automoderator-port.md for the milestone context and schema.sql's
// AutoModerator section for the target shape.
//
// Unlike Social's, there is exactly one entrypoint -- there is no sandbox-copy sibling, because AutoModerator
// has no equivalent of "stock a test guild with real leveling data" that would be worth the loaded gun of a
// `--as-guild` flag on a script that also touches every guild's ban history.
//
// Legacy identifiers are quoted throughout and taken from `origin/v2`'s `prisma/migrations/`, not from its
// `schema.prisma`: Prisma's `@@map`/`@map` only describe what it *would* generate, and two of these tables
// were renamed by a later hand-written migration while three columns never got a `@map` at all and are
// physically camelCase (`cases."useTimeouts"`, `automod_triggers."updatedAt"`,
// `guild_settings."useTimeoutsByDefault"`). The `"BypassRole"` table never got renamed either. Every query
// below aliases to snake_case so the `postgres.camel` transform `createDb` applies hands them back as
// camelCase, and the aliases double as a reviewable statement of the old-to-new mapping.

import { encryptWithKey, type Database } from '../../index.js';
import { BATCH_SIZE, chunk, statFor, type Executor, type Stats, type TableStat } from './migrationCommon.js';

/**
 * Discord's own ceiling on a communication timeout, in seconds (28 days).
 *
 * Duplicated from `MAX_TIMEOUT_SECONDS` in `@chatsift/core` rather than imported: that package already
 * depends on this one for its row types, so depending on it from here would close a cycle in the build
 * graph for the sake of one number in a script that runs once. P2's stated invariant is that nothing clamps
 * a rung at runtime, so a migrated MUTE rung longer than this is one Discord refuses and that therefore
 * silently never fires -- which is exactly why the clamp has to happen here.
 */
const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;

// The remaining bounds the API's zod schemas enforce on these settings. Same duplication, same reason. A
// migrated row outside them is legal as far as the database is concerned but cannot be saved again from the
// dashboard without being changed first, so the migration clamps and reports rather than writing a value the
// guild's next visit to the config screen would reject.
const AUTO_PARDON_MAX_DAYS = 3_650;
const ANTISPAM_MIN_AMOUNT = 2;
const ANTISPAM_MAX_AMOUNT = 100;
const ANTISPAM_MAX_SECONDS = 300;
const TRIGGER_DECAY_MAX_MINUTES = 30 * 24 * 60;
const MIN_JOIN_AGE_MAX_SECONDS = 365 * 24 * 60 * 60;

/**
 * Notes a value this migration changed on the way through, so the run can print them instead of leaving a
 * guild to discover its ladder was clamped when a rung doesn't fire.
 */
export interface Adjustment {
	readonly detail: string;
	readonly guildId: string;
	readonly kind: string;
}

export interface CopyContext {
	/**
	 * Collected as the copy runs; printed by the entrypoint once it finishes.
	 */
	readonly adjustments: Adjustment[];
	/**
	 * `ENCRYPTION_KEY`, for `automoderator_log_webhooks.webhook_token`.
	 */
	readonly encryptionKey: string;
	/**
	 * One timestamp for the whole run, so "is this warn old enough to pardon" and "has this tempban already
	 * expired" are answered against a single instant rather than drifting across a migration that takes
	 * minutes.
	 */
	readonly now: Date;
	/**
	 * The AutoModerator application id, written into `pardoned_by` for warns this migration pre-pardons.
	 * Matches what the runtime sweep writes (`getSelfId`), so a pre-pardoned warn is indistinguishable from
	 * one the sweep would have handled.
	 */
	readonly pardonActorId: string;
}

function note(context: CopyContext, guildId: string, kind: string, detail: string): void {
	context.adjustments.push({ guildId, kind, detail });
}

/**
 * Clamps into `[min, max]`, recording an adjustment when it actually changes something.
 */
function clamp(context: CopyContext, guildId: string, kind: string, value: number, min: number, max: number): number {
	const clamped = Math.min(Math.max(value, min), max);
	if (clamped !== value) {
		note(context, guildId, kind, `${value} clamped to ${clamped}`);
	}

	return clamped;
}

/**
 * Legacy durations are unbounded milliseconds in a BIGINT, which postgres.js hands back as a *string*
 * because it does not fit a JS number. Seconds in an INTEGER is what every duration column in the new schema
 * holds.
 *
 * Rounds up rather than down so a sub-second legacy duration becomes one second rather than zero, which the
 * target CHECKs reject.
 */
function msToSeconds(milliseconds: bigint | number | string | null): number | null {
	if (milliseconds === null) {
		return null;
	}

	const value = BigInt(milliseconds);
	if (value <= 0n) {
		return null;
	}

	return Number((value + 999n) / 1_000n);
}

// ---------------------------------------------------------------------------
// Enum mappings
//
// Written out rather than done with `.toUpperCase()` so an unrecognized label -- which would mean the legacy
// schema drifted from what this script was written against -- fails loudly here instead of being handed to
// Postgres as an invalid enum value mid-transaction. Same treatment the Social migration gives its one enum.
// ---------------------------------------------------------------------------

const CASE_ACTION_MAP: Record<string, string> = {
	warn: 'WARN',
	mute: 'MUTE',
	unmute: 'UNMUTE',
	kick: 'KICK',
	softban: 'SOFTBAN',
	ban: 'BAN',
	unban: 'UNBAN',
};

const WARN_PUNISHMENT_ACTION_MAP: Record<string, string> = {
	mute: 'MUTE',
	kick: 'KICK',
	ban: 'BAN',
};

const TRIGGER_PUNISHMENT_ACTION_MAP: Record<string, string> = {
	warn: 'WARN',
	mute: 'MUTE',
	kick: 'KICK',
	ban: 'BAN',
};

const LOG_TYPE_MAP: Record<string, string> = {
	mod: 'MOD',
	filter: 'FILTER',
	user: 'USER',
	message: 'MESSAGE',
};

export const LEGACY_CASE_ACTIONS = Object.keys(CASE_ACTION_MAP);
export const LEGACY_LOG_TYPES = Object.keys(LOG_TYPE_MAP);

function mapEnum(map: Record<string, string>, label: string, what: string): string {
	const mapped = map[label];
	if (mapped === undefined) {
		throw new Error(
			`unrecognized legacy ${what} ${JSON.stringify(label)} — expected one of ${Object.keys(map).join(', ')}. ` +
				'The legacy schema has drifted from what this script was written against.',
		);
	}

	return mapped;
}

// ---------------------------------------------------------------------------
// Bitfields
//
// Both of these lived in `@automoderator/broker-types`, which only exists on the `v2` branch. The bit order
// is `BitField.makeFlags([...])`'s: member N is `1 << N`.
// ---------------------------------------------------------------------------

/**
 * `FILTERS = BitField.makeFlags(['urls', 'files', 'invites', 'words', 'automod', 'global'])`, paired with the
 * `automoderator_filter_kind` value each one became.
 *
 * Three of the six have no target: `words` because Discord's own per-rule channel exemptions are the right
 * place to stop a native match, and `files`/`global` because features 05 and 04 were dropped. `automod` is
 * the anti-spam runner -- legacy's `AntispamRunner.ignore` is the string `'automod'`, which is worth stating
 * because the name suggests it covers everything and it never did.
 */
const FILTER_IGNORE_BITS: readonly (readonly [bit: bigint, filter: string | null])[] = [
	[1n, 'URLS'],
	[2n, null],
	[4n, 'INVITES'],
	[8n, null],
	[16n, 'ANTISPAM'],
	[32n, null],
];

export function decodeFilterIgnores(value: bigint | number | string): string[] {
	const bits = BigInt(value);
	return FILTER_IGNORE_BITS.filter(([bit, filter]) => filter !== null && (bits & bit) === bit).map(
		([, filter]) => filter!,
	);
}

/**
 * `BANWORD_FLAGS = BitField.makeFlags(['word', 'warn', 'mute', 'ban', 'report', 'name', 'kick'])`.
 *
 * Decoded straight through with no value dropped, because this feeds the read-only archive rather than
 * anything that acts -- including `name`, the username-filtering flag that went with dropped feature 15 and
 * is the one entry a guild rebuilding its list genuinely cannot recreate.
 */
const BANWORD_FLAG_BITS: readonly (readonly [bit: bigint, name: string])[] = [
	[1n, 'word'],
	[2n, 'warn'],
	[4n, 'mute'],
	[8n, 'ban'],
	[16n, 'report'],
	[32n, 'name'],
	[64n, 'kick'],
];

export function decodeBanwordFlags(value: bigint | number | string): string[] {
	const bits = BigInt(value);
	return BANWORD_FLAG_BITS.filter(([bit]) => (bits & bit) === bit).map(([, name]) => name);
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

/**
 * The subset of `@chatsift/core`'s `normalizeAllowedDomain` a legacy `allowed_urls.domain` can need.
 *
 * Duplicated for the same build-graph reason as `MAX_TIMEOUT_SECONDS` above. It is a subset rather than a
 * copy because legacy's own `cleanDomain` already stripped `https?://` and everything after the first `/`
 * before storing -- what it never did is lowercase, trim, or reject a malformed entry, and it dropped every
 * label but the last two (see `findPublicSuffixLookalikes`).
 *
 * Returns `null` for an entry the new matcher could never match, which the caller drops and reports.
 */
export function normalizeLegacyDomain(input: string): string | null {
	const withoutScheme = input
		.trim()
		.toLowerCase()
		.replace(/^[a-z][\w+.-]*:\/\//i, '')
		.replace(/^\/\//, '');
	const host = withoutScheme.split(/[#/?]/)[0] ?? '';

	// A userinfo or port section is not part of the host the filter extracts from a message.
	const withoutUserinfo = host.includes('@') ? (host.split('@').pop() ?? '') : host;
	const bare = withoutUserinfo.split(':')[0] ?? '';

	const labels = bare.split('.');
	if (labels.length < 2 || labels.some((label) => label.length === 0)) {
		return null;
	}

	return bare;
}

/**
 * Two-label allowlist entries that are almost certainly a registry suffix rather than a site.
 *
 * Legacy reduced every entry it stored -- and every host it checked -- to its last two labels, so a guild
 * that allowlisted `shop.example.co.uk` has a row reading `co.uk`. Under the new suffix matcher that row
 * allows *every* `.co.uk` domain there is. It allowed the same set under legacy's matcher, so migrating it
 * is not a regression and dropping it silently would be one -- but it is a hole worth naming rather than
 * inheriting quietly, so these are reported and left for the owner to raise with the guild.
 *
 * A fixed list of well-known second-level registry labels, not a public-suffix list: the port deliberately
 * has none (`findAllowedDomain`'s label-boundary matching is what makes one unnecessary), and pulling one in
 * for a one-shot report would be the tail wagging the dog.
 */
const REGISTRY_SECOND_LEVEL_LABELS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'gob', 'govt', 'net', 'org', 'sch']);

export function isPublicSuffixLookalike(domain: string): boolean {
	const labels = domain.split('.');
	return labels.length === 2 && labels[1]!.length === 2 && REGISTRY_SECOND_LEVEL_LABELS.has(labels[0]!);
}

// ---------------------------------------------------------------------------
// Legacy row shapes
// ---------------------------------------------------------------------------

export interface LegacyGuildSettings {
	antispamAmount: number | null;
	antispamTime: number | null;
	autoPardonWarnsAfter: number | null;
	automodCooldown: number | null;
	guildId: string;
	minJoinAge: string | null;
	reportsChannel: string | null;
	useInviteFilters: boolean;
	useUrlFilters: boolean;
}

export interface LegacyCase {
	actionType: string;
	caseId: number;
	createdAt: Date;
	expiresAt: Date | null;
	guildId: string;
	hasPendingTask: boolean;
	id: number;
	logMessageId: string | null;
	modId: string | null;
	modTag: string | null;
	pardonedBy: string | null;
	reason: string | null;
	refId: number | null;
	targetId: string;
	targetTag: string;
	useTimeouts: boolean;
}

// ---------------------------------------------------------------------------
// Guild settings, and the case-number high-water mark that travels with them
// ---------------------------------------------------------------------------

/**
 * Every guild this migration touches: the union of legacy's `guild_settings` and every guild that merely has
 * cases.
 *
 * The union matters more than it looks. `allocateCaseNumber` upserts
 * `automoderator_guild_settings.last_case_id`, starting at 1 when there is no row -- so a guild whose cases
 * migrate without a settings row would hand its next case the number 1 and collide with the migrated case
 * #1 on the unique constraint. Every guild with cases therefore gets a settings row carrying its high-water
 * mark, whether or not legacy stored one.
 */
export async function collectLegacyGuildIds(legacy: Database): Promise<string[]> {
	const rows = await legacy<{ guildId: string }[]>`
		SELECT "guild_id" AS guild_id FROM "guild_settings"
		UNION
		SELECT "guild_id" AS guild_id FROM "cases"
		ORDER BY guild_id
	`;

	return rows.map((row) => row.guildId);
}

/**
 * The highest case number legacy handed out per guild -- `MAX(case_id)`, not `COUNT(*)`, since legacy's
 * allocator skipped numbers whenever a case was deleted.
 */
export async function collectLegacyCaseCeilings(legacy: Database): Promise<Map<string, number>> {
	const rows = await legacy<{ guildId: string; maxCaseId: number }[]>`
		SELECT "guild_id" AS guild_id, MAX("case_id") AS max_case_id FROM "cases" GROUP BY "guild_id"
	`;

	return new Map(rows.map((row) => [row.guildId, Number(row.maxCaseId)]));
}

export interface TargetCaseState {
	guildId: string;
	lastCaseId: number;
	maxCaseId: number;
}

/**
 * What the target already holds for these guilds, which on this cutover is not hypothetical: the canary
 * deployment has been live and open to anyone since before the migration date, so guilds that tried
 * AutoModerator on the new stack already have cases numbered from 1 -- the same numbers legacy is about to
 * migrate.
 */
export async function collectTargetCaseState(target: Executor, guildIds: string[]): Promise<TargetCaseState[]> {
	return target<TargetCaseState[]>`
		SELECT
			s.guild_id                                AS guild_id,
			s.last_case_id                            AS last_case_id,
			COALESCE(MAX(c.case_id), 0)               AS max_case_id
		FROM automoderator_guild_settings s
		LEFT JOIN automoderator_cases c ON c.guild_id = s.guild_id
		WHERE s.guild_id = ANY(${guildIds})
		GROUP BY s.guild_id, s.last_case_id
		HAVING s.last_case_id > 0 OR COALESCE(MAX(c.case_id), 0) > 0
		ORDER BY s.guild_id
	`;
}

/**
 * Moves a guild's existing new-stack cases above everything legacy is about to insert, so legacy keeps the
 * numbers it has always had.
 *
 * **Which side gets renumbered is the whole decision here.** Legacy numbers are years of records quoted in
 * mod-log embeds, `/history` output and moderator conversation; the new-stack rows are days-old canary
 * testing. Shifting the small, recent set is the only version of this that does not invalidate the archive
 * it exists to preserve. The cost, which the run reports: a shifted case's already-posted log embed still
 * has its old number printed in the text, so those few embeds disagree with the dashboard until somebody
 * edits the case.
 *
 * `ref_id` and `automoderator_reports.case_id` shift with it -- both name a guild-scoped `case_id` rather
 * than an `id`, so leaving either behind would silently repoint it at whichever legacy case lands on that
 * number.
 *
 * **This is the one operation in the migration that is not naturally idempotent**, which is why it guards
 * itself rather than trusting the caller. Everything else writes through `ON CONFLICT DO NOTHING` and so a
 * second run changes nothing; an unguarded shift would instead move the *already-migrated* rows again on
 * every run, quietly destroying the numbering it exists to protect. The guard is that it only fires when
 * every one of the guild's target cases is one this migration has not written -- identified by
 * `(case_id, created_at)`, which a migrated row shares exactly with its legacy original and a case filed on
 * the new stack never does -- and at least one of them sits inside the range legacy is about to reuse.
 */
export async function shiftTargetCases(
	legacy: Database,
	target: Executor,
	guildId: string,
	offset: number,
): Promise<number> {
	const legacyPairs = new Set(
		(
			await legacy<{ caseId: number; createdAt: Date }[]>`
				SELECT "case_id" AS case_id, "created_at" AS created_at FROM "cases" WHERE "guild_id" = ${guildId}
			`
		).map((row) => `${row.caseId}|${row.createdAt.toISOString()}`),
	);

	const existing = await target<{ caseId: number; createdAt: Date }[]>`
		SELECT case_id, created_at FROM automoderator_cases WHERE guild_id = ${guildId}
	`;

	// Any already-migrated row means this guild has been through the migration before, so the shift has
	// already happened and repeating it would be the bug. Bail out wholesale rather than shifting the
	// remainder: a partial shift would move cases filed since without moving the ones they reference.
	const alreadyMigrated = existing.some((row) => legacyPairs.has(`${row.caseId}|${row.createdAt.toISOString()}`));
	if (alreadyMigrated) {
		return 0;
	}

	// Nothing in the range legacy is about to take: the guild's new-stack cases already sit above it, so
	// there is no collision to make room for.
	if (!existing.some((row) => row.caseId <= offset)) {
		return 0;
	}

	const shifted = await target<{ id: number }[]>`
		UPDATE automoderator_cases
		SET case_id = case_id + ${offset},
		    ref_id  = CASE WHEN ref_id IS NULL THEN NULL ELSE ref_id + ${offset} END
		WHERE guild_id = ${guildId}
		RETURNING id
	`;

	await target`
		UPDATE automoderator_reports
		SET case_id = case_id + ${offset}
		WHERE guild_id = ${guildId} AND case_id IS NOT NULL
	`;

	return shifted.length;
}

export async function copyGuildSettings(
	legacy: Database,
	tx: Executor,
	context: CopyContext,
	ceilings: Map<string, number>,
): Promise<TableStat> {
	const rows = await legacy<LegacyGuildSettings[]>`
		SELECT
			"guild_id"                AS guild_id,
			"reports_channel"         AS reports_channel,
			"auto_pardon_warns_after" AS auto_pardon_warns_after,
			"use_url_filters"         AS use_url_filters,
			"use_invite_filters"      AS use_invite_filters,
			"min_join_age"            AS min_join_age,
			"antispam_amount"         AS antispam_amount,
			"antispam_time"           AS antispam_time,
			"automod_cooldown"        AS automod_cooldown
		FROM "guild_settings"
		ORDER BY "guild_id"
	`;

	const byGuild = new Map(rows.map((row) => [row.guildId, row]));
	const guildIds = [...new Set([...byGuild.keys(), ...ceilings.keys()])].sort((left, right) =>
		left.localeCompare(right),
	);

	const values = guildIds.map((guildId) => {
		const row = byGuild.get(guildId);

		// A guild with cases but no settings row: legacy never required one, and the only column that has to
		// be right for such a guild is the case ceiling.
		if (!row) {
			return {
				guildId,
				lastCaseId: ceilings.get(guildId) ?? 0,
				reportsChannelId: null,
				autoPardonWarnsAfter: null,
				useUrlFilters: false,
				useInviteFilters: false,
				antispamAmount: null,
				antispamTime: null,
				triggerDecayMinutes: null,
				minJoinAgeSeconds: null,
			};
		}

		// Both or neither, and never a threshold the CHECK rejects. Legacy had no constraint tying the pair
		// together, so one-of-two is a shape that exists in the data and means nothing the bot could act on.
		let antispamAmount = row.antispamAmount;
		let antispamTime = row.antispamTime;
		if (antispamAmount === null || antispamTime === null) {
			if (antispamAmount !== null || antispamTime !== null) {
				note(context, guildId, 'antispam', 'only one of amount/time was set; anti-spam left off');
			}

			antispamAmount = null;
			antispamTime = null;
		} else {
			antispamAmount = clamp(
				context,
				guildId,
				'antispamAmount',
				antispamAmount,
				ANTISPAM_MIN_AMOUNT,
				ANTISPAM_MAX_AMOUNT,
			);
			antispamTime = clamp(context, guildId, 'antispamTime', antispamTime, 1, ANTISPAM_MAX_SECONDS);
		}

		// Legacy stored unbounded milliseconds in a BIGINT; the column is seconds in an INTEGER, and `0` was
		// legacy's way of spelling "off" without a NULL.
		const minJoinAgeRaw = msToSeconds(row.minJoinAge);
		const minJoinAgeSeconds =
			minJoinAgeRaw === null ? null : clamp(context, guildId, 'minJoinAge', minJoinAgeRaw, 1, MIN_JOIN_AGE_MAX_SECONDS);

		const autoPardonWarnsAfter =
			row.autoPardonWarnsAfter === null || row.autoPardonWarnsAfter <= 0
				? null
				: clamp(context, guildId, 'autoPardonWarnsAfter', row.autoPardonWarnsAfter, 1, AUTO_PARDON_MAX_DAYS);

		// `automod_cooldown` is legacy's name for what is now `trigger_decay_minutes`, and it was already in
		// minutes -- its scheduler compared `getMinutes()` against `getMinutes()`, which is why the decay never
		// worked, but the *unit* was always right.
		const triggerDecayMinutes =
			row.automodCooldown === null || row.automodCooldown <= 0
				? null
				: clamp(context, guildId, 'triggerDecay', row.automodCooldown, 1, TRIGGER_DECAY_MAX_MINUTES);

		return {
			guildId,
			lastCaseId: ceilings.get(guildId) ?? 0,
			reportsChannelId: row.reportsChannel,
			autoPardonWarnsAfter,
			useUrlFilters: row.useUrlFilters,
			useInviteFilters: row.useInviteFilters,
			antispamAmount,
			antispamTime,
			triggerDecayMinutes,
			minJoinAgeSeconds,
		};
	});

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		// `DO UPDATE` on `last_case_id` alone, and `GREATEST` rather than an assignment. Every other column is
		// left as the target has it, which is the same "a pre-existing target row wins" rule every other table
		// here follows through `DO NOTHING` -- a guild that configured AutoModerator on the new stack did that
		// more recently and more deliberately than whatever legacy holds. The ceiling is the one column where
		// losing is not an option: it is what stops the next case colliding with a migrated one.
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO automoderator_guild_settings ${tx(
				batch,
				'guildId',
				'lastCaseId',
				'reportsChannelId',
				'autoPardonWarnsAfter',
				'useUrlFilters',
				'useInviteFilters',
				'antispamAmount',
				'antispamTime',
				'triggerDecayMinutes',
				'minJoinAgeSeconds',
			)}
			ON CONFLICT (guild_id) DO UPDATE
				SET last_case_id = GREATEST(automoderator_guild_settings.last_case_id, EXCLUDED.last_case_id)
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	// `DO UPDATE` makes every row a hit, so the "skipped" column would read zero and say nothing. The number
	// worth printing is how many of these guilds legacy actually had settings for.
	return statFor(guildIds.length, byGuild.size);
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

/**
 * Legacy case numbers that were handed out twice in one guild.
 *
 * Legacy allocated with `findFirst(orderBy: caseId desc) + 1` inside its transaction and had no unique
 * constraint to catch the race, which its own source calls out as a TODO. The target does have one, so
 * without this the second case of a colliding pair would be swallowed by `ON CONFLICT DO NOTHING` and a real
 * moderation record would vanish in a migration that reported success.
 *
 * Keyed by legacy `id`, valued with the fresh number to write instead. The earliest-created row of each pair
 * keeps the contested number -- it is the one whose number was quoted in whatever log embed went out at the
 * time.
 */
export async function planDuplicateCaseNumbers(
	legacy: Database,
	ceilings: Map<string, number>,
): Promise<Map<number, number>> {
	const duplicates = await legacy<{ caseId: number; guildId: string; id: number }[]>`
		SELECT "id" AS id, "guild_id" AS guild_id, "case_id" AS case_id
		FROM "cases"
		WHERE ("guild_id", "case_id") IN (
			SELECT "guild_id", "case_id" FROM "cases" GROUP BY "guild_id", "case_id" HAVING COUNT(*) > 1
		)
		ORDER BY "guild_id", "case_id", "created_at", "id"
	`;

	const plan = new Map<number, number>();
	const nextFree = new Map<string, number>();
	let seen: string | null = null;

	for (const row of duplicates) {
		const key = `${row.guildId}/${row.caseId}`;

		// First row of each colliding group keeps the number it has.
		if (key !== seen) {
			seen = key;
			continue;
		}

		const next = (nextFree.get(row.guildId) ?? ceilings.get(row.guildId) ?? 0) + 1;
		nextFree.set(row.guildId, next);
		plan.set(Number(row.id), next);
	}

	return plan;
}

export interface MappedCase {
	readonly prePardoned: boolean;
	readonly value: {
		actionType: string;
		caseId: number;
		createdAt: Date;
		expiresAt: Date | null;
		guildId: string;
		idempotencyKey: string | null;
		liftedAt: Date | null;
		logMessageId: string | null;
		modId: string | null;
		modTag: string | null;
		pardonedBy: string | null;
		reason: string | null;
		refId: number | null;
		targetId: string;
		targetTag: string;
	};
}

export interface CaseMappingOptions {
	/**
	 * Per-guild `auto_pardon_warns_after`, for guilds that configured it. Absent means the guild never did,
	 * and nothing is pre-pardoned there.
	 */
	readonly autoPardonDays: Map<string, number>;
	/**
	 * Fresh numbers for cases whose legacy number was handed out twice, keyed by legacy `id`.
	 */
	readonly duplicatePlan: Map<number, number>;
}

/**
 * One legacy case row, mapped. Pure and exported so the two decisions in it can be tested directly -- they
 * are the two that would be worst to get wrong, and neither is visible from a row count.
 */
export function mapCase(row: LegacyCase, context: CopyContext, options: CaseMappingOptions): MappedCase {
	const action = mapEnum(CASE_ACTION_MAP, row.actionType, 'CaseAction');

	// Legacy's auto-pardon never fired: its scheduler read a per-guild cache with `get()`, compared the miss
	// against `== null`, and `continue`d -- on the first case of every guild, forever. So a guild that
	// configured it has a backlog of warns that should already be pardoned, and the new sweep would work
	// through them at a hundred per ten minutes, rewriting a years-old mod-log embed for each.
	//
	// Doing it here instead leaves the sweep nothing to find. The embeds stay as legacy wrote them, which is
	// the deliberate half of the trade: `/history` and the dashboard show the truth from the first minute,
	// and nobody watches ancient log messages mutate for a week.
	const pardonAfterDays = options.autoPardonDays.get(row.guildId);
	const prePardoned =
		action === 'WARN' &&
		row.pardonedBy === null &&
		pardonAfterDays !== undefined &&
		row.createdAt.getTime() + pardonAfterDays * 86_400_000 <= context.now.getTime();

	// Only a BAN has anything for the expiry sweep to do -- a MUTE is a native timeout Discord expires by
	// itself, and the sweep's index is partial on `action_type = 'BAN'`.
	//
	// The three readings, in the order they have to be taken:
	//   * a pending task means legacy still owed this unban, so `lifted_at` stays NULL and the new sweep
	//     picks it up -- immediately, if it is already overdue, which is legacy having failed to lift it and
	//     the new stack finally doing so;
	//   * no task and an expiry still in the future is a task deleted after three failures, or a case older
	//     than the scheduler itself. NULL again: P2's own rule is that giving up on an unban produces a
	//     permanent ban claiming to be temporary;
	//   * no task and an expiry in the past is a tempban legacy already lifted. Marking it lifted at its
	//     expiry is what stops the sweep unbanning, on cutover day, every person ever tempbanned here --
	//     including the ones who have been banned again since.
	const alreadyLifted =
		action === 'BAN' &&
		row.expiresAt !== null &&
		!row.hasPendingTask &&
		row.expiresAt.getTime() <= context.now.getTime();

	return {
		prePardoned,
		value: {
			guildId: row.guildId,
			caseId: options.duplicatePlan.get(Number(row.id)) ?? row.caseId,
			refId: row.refId,
			targetId: row.targetId,
			targetTag: row.targetTag,
			modId: row.modId,
			modTag: row.modTag,
			actionType: action,
			reason: row.reason,
			expiresAt: row.expiresAt,
			liftedAt: alreadyLifted ? row.expiresAt : null,
			pardonedBy: prePardoned ? context.pardonActorId : row.pardonedBy,
			logMessageId: row.logMessageId,
			// Command-authored as far as the new stack is concerned. The idempotency key exists for cases this
			// bot files in response to a gateway event, and nothing here will ever be re-derived.
			idempotencyKey: null,
			createdAt: row.createdAt,
		},
	};
}

/**
 * Copies `cases`, paging on the legacy primary key.
 *
 * Paged rather than read whole because this is the one table of unknown magnitude -- every moderation action
 * AutoModerator has taken since 2021 -- and ordering by `id` ascending also means the target's identity
 * column hands out ids in legacy's creation order, which is what the case browser's
 * `(guild_id, id DESC)` keyset pagination sorts on.
 */
export async function copyCases(
	legacy: Database,
	tx: Executor,
	context: CopyContext,
	options: CaseMappingOptions,
): Promise<{ prePardoned: number; stat: TableStat }> {
	let cursor = 0;
	let read = 0;
	let inserted = 0;
	let prePardoned = 0;

	for (;;) {
		// `timed_case_tasks` is joined rather than copied: the new schema has no task table, because
		// `expires_at IS NOT NULL AND lifted_at IS NULL` *is* the scheduler's queue. What the join carries
		// across is the one fact the case row cannot express on its own -- whether legacy still owed this
		// punishment an undo.
		const rows = await legacy<LegacyCase[]>`
			SELECT
				c."id"              AS id,
				c."guild_id"        AS guild_id,
				c."case_id"         AS case_id,
				c."ref_id"          AS ref_id,
				c."target_id"       AS target_id,
				c."target_tag"      AS target_tag,
				c."mod_id"          AS mod_id,
				c."mod_tag"         AS mod_tag,
				c."action_type"::text AS action_type,
				c."reason"          AS reason,
				c."expires_at"      AS expires_at,
				c."pardoned_by"     AS pardoned_by,
				c."log_message_id"  AS log_message_id,
				c."created_at"      AS created_at,
				c."useTimeouts"     AS use_timeouts,
				(t."case_id" IS NOT NULL) AS has_pending_task
			FROM "cases" c
			LEFT JOIN "timed_case_tasks" t ON t."case_id" = c."id"
			WHERE c."id" > ${cursor}
			ORDER BY c."id" ASC
			LIMIT ${BATCH_SIZE}
		`;

		if (rows.length === 0) {
			break;
		}

		cursor = Number(rows.at(-1)!.id);
		read += rows.length;

		const mapped = rows.map((row) => mapCase(row, context, options));
		prePardoned += mapped.filter((entry) => entry.prePardoned).length;
		const values = mapped.map((entry) => entry.value);

		const result = await tx<{ id: number }[]>`
			INSERT INTO automoderator_cases ${tx(
				values,
				'guildId',
				'caseId',
				'refId',
				'targetId',
				'targetTag',
				'modId',
				'modTag',
				'actionType',
				'reason',
				'expiresAt',
				'liftedAt',
				'pardonedBy',
				'logMessageId',
				'idempotencyKey',
				'createdAt',
			)}
			ON CONFLICT (guild_id, case_id) DO NOTHING
			RETURNING id
		`;
		inserted += result.length;
	}

	// Nothing here reconciles `last_case_id` with the numbers just written -- duplicate renumbering pushes a
	// guild above the ceiling this was handed. `syncCaseCeilings` does it once at the end, against the table
	// rather than against a running total.
	return { prePardoned, stat: statFor(read, inserted) };
}

/**
 * Re-synchronises every touched guild's `last_case_id` with the cases that actually landed.
 *
 * Belt and braces on purpose: duplicate renumbering pushes a guild above the ceiling computed before the
 * copy, a target shift moves canary rows above it, and `GREATEST` in the settings upsert only knows about
 * what it was handed. One statement at the end, reading the table it has to agree with, removes every way
 * those three can disagree -- and getting it wrong means the guild's next case collides on the unique
 * constraint and fails outright.
 */
export async function syncCaseCeilings(tx: Executor, guildIds: string[]): Promise<number> {
	const updated = await tx<{ guildId: string }[]>`
		UPDATE automoderator_guild_settings s
		SET last_case_id = c.max_case_id
		FROM (
			SELECT guild_id, MAX(case_id) AS max_case_id
			FROM automoderator_cases
			WHERE guild_id = ANY(${guildIds})
			GROUP BY guild_id
		) c
		WHERE s.guild_id = c.guild_id AND s.last_case_id < c.max_case_id
		RETURNING s.guild_id
	`;

	return updated.length;
}

// ---------------------------------------------------------------------------
// Ladders
// ---------------------------------------------------------------------------

/**
 * Shared rung mapping for both ladders, which differ only in table, column name and which actions may carry
 * a duration.
 *
 * Returns `null` for a rung that cannot be represented, which the caller drops and reports. There is exactly
 * one such shape: a MUTE with no duration. A timeout has no open-ended form, the CHECK forbids it, and
 * legacy's own runner passed `expiresAt: undefined` for it -- so the rung was already inert there. Dropping
 * it loses nothing and keeps the migration from aborting on a row the guild never saw work.
 */
function mapRung(
	context: CopyContext,
	guildId: string,
	kind: string,
	step: string,
	action: string,
	durationMs: string | null,
): { actionType: string; durationSeconds: number | null } | null {
	const seconds = msToSeconds(durationMs);

	if (action === 'MUTE') {
		if (seconds === null) {
			note(context, guildId, kind, `dropped the ${step} rung: a MUTE with no duration cannot be a timeout`);
			return null;
		}

		return {
			actionType: action,
			durationSeconds: clamp(context, guildId, `${kind} mute duration`, seconds, 1, MAX_TIMEOUT_SECONDS),
		};
	}

	if (action === 'BAN') {
		return { actionType: action, durationSeconds: seconds };
	}

	// WARN and KICK carry no duration at all, and both CHECKs say so. Legacy's column allowed one; nothing
	// ever read it for these two.
	if (seconds !== null) {
		note(context, guildId, kind, `dropped the duration on the ${step} rung: a ${action} has nothing to expire`);
	}

	return { actionType: action, durationSeconds: null };
}

export async function copyWarnPunishments(legacy: Database, tx: Executor, context: CopyContext): Promise<TableStat> {
	const rows = await legacy<{ actionType: string; duration: string | null; guildId: string; warns: number }[]>`
		SELECT
			"guild_id"          AS guild_id,
			"warns"             AS warns,
			"action_type"::text AS action_type,
			"duration"          AS duration
		FROM "warn_punishments"
		ORDER BY "guild_id", "warns"
	`;

	const values = rows.flatMap((row) => {
		if (row.warns < 1) {
			note(context, row.guildId, 'warn ladder', `dropped a rung at ${row.warns} warns`);
			return [];
		}

		const action = mapEnum(WARN_PUNISHMENT_ACTION_MAP, row.actionType, 'WarnPunishmentAction');
		const mapped = mapRung(context, row.guildId, 'warn ladder', `${row.warns}-warn`, action, row.duration);

		return mapped ? [{ guildId: row.guildId, warns: row.warns, ...mapped }] : [];
	});

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO automoderator_warn_punishments ${tx(batch, 'guildId', 'warns', 'actionType', 'durationSeconds')}
			ON CONFLICT (guild_id, warns) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

export async function copyTriggerPunishments(legacy: Database, tx: Executor, context: CopyContext): Promise<TableStat> {
	const rows = await legacy<{ actionType: string; duration: string | null; guildId: string; triggers: number }[]>`
		SELECT
			"guild_id"          AS guild_id,
			"triggers"          AS triggers,
			"action_type"::text AS action_type,
			"duration"          AS duration
		FROM "automod_punishments"
		ORDER BY "guild_id", "triggers"
	`;

	const values = rows.flatMap((row) => {
		if (row.triggers < 1) {
			note(context, row.guildId, 'trigger ladder', `dropped a rung at ${row.triggers} triggers`);
			return [];
		}

		const action = mapEnum(TRIGGER_PUNISHMENT_ACTION_MAP, row.actionType, 'AutomodPunishmentAction');
		const mapped = mapRung(context, row.guildId, 'trigger ladder', `${row.triggers}-trigger`, action, row.duration);

		return mapped ? [{ guildId: row.guildId, triggers: row.triggers, ...mapped }] : [];
	});

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO automoderator_trigger_punishments ${tx(batch, 'guildId', 'triggers', 'actionType', 'durationSeconds')}
			ON CONFLICT (guild_id, triggers) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

// ---------------------------------------------------------------------------
// Logging, exemptions and allowlists
// ---------------------------------------------------------------------------

/**
 * The one table whose values are encrypted at rest. Legacy stored these tokens in plaintext; a webhook token
 * is a standing capability to post into somebody's guild, so a dump should not carry a usable one for every
 * configured server.
 *
 * Migrating the webhook rather than asking every guild to re-pick its log channels also buys the thing
 * migrated cases need: the mod-log messages `automoderator_cases.log_message_id` points at were posted by
 * these very webhooks, and editing a webhook message needs the token that created it. A fresh webhook could
 * never rewrite a legacy embed.
 */
export async function copyLogWebhooks(legacy: Database, tx: Executor, context: CopyContext): Promise<TableStat> {
	const rows = await legacy<
		{
			channelId: string;
			guildId: string;
			logType: string;
			threadId: string | null;
			webhookId: string;
			webhookToken: string;
		}[]
	>`
		SELECT
			"guild_id"      AS guild_id,
			"log_type"::text AS log_type,
			"channel_id"    AS channel_id,
			"webhook_id"    AS webhook_id,
			"webhook_token" AS webhook_token,
			"thread_id"     AS thread_id
		FROM "webhook_tokens"
		ORDER BY "guild_id", "log_type"
	`;

	const values = rows.map((row) => ({
		guildId: row.guildId,
		logType: mapEnum(LOG_TYPE_MAP, row.logType, 'LogChannelType'),
		channelId: row.channelId,
		webhookId: row.webhookId,
		webhookToken: encryptWithKey(context.encryptionKey, row.webhookToken),
		threadId: row.threadId,
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO automoderator_log_webhooks ${tx(
				batch,
				'guildId',
				'logType',
				'channelId',
				'webhookId',
				'webhookToken',
				'threadId',
			)}
			ON CONFLICT (guild_id, log_type) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

export async function copyBypassRoles(legacy: Database, tx: Executor): Promise<TableStat> {
	// `"BypassRole"` keeps its Prisma model name: it was added in 2022 without an `@@map` and the
	// cleanup-naming migration that renamed the rest had already run. Keyed on `role_id` alone there, which
	// is globally unique and so worked, but also meant one guild's row could be deleted by a request naming
	// another's -- the target is guild-scoped.
	const rows = await legacy<{ guildId: string; roleId: string }[]>`
		SELECT "guild_id" AS guild_id, "role_id" AS role_id FROM "BypassRole" ORDER BY "guild_id", "role_id"
	`;

	let inserted = 0;
	for (const batch of chunk(rows, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO automoderator_bypass_roles ${tx(batch, 'guildId', 'roleId')}
			ON CONFLICT (guild_id, role_id) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

export async function copyLogExemptions(legacy: Database, tx: Executor): Promise<TableStat> {
	const rows = await legacy<{ channelId: string; guildId: string }[]>`
		SELECT "guild_id" AS guild_id, "channel_id" AS channel_id FROM "log_ignores" ORDER BY "guild_id", "channel_id"
	`;

	let inserted = 0;
	for (const batch of chunk(rows, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO automoderator_log_exemptions ${tx(batch, 'guildId', 'channelId')}
			ON CONFLICT (guild_id, channel_id) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

/**
 * One legacy bitfield row fans out into one row per filter it named.
 *
 * A channel exempted from nothing but dropped filters (`files`, `words`, `global`) produces no rows at all,
 * which is correct and is counted as read-but-not-inserted rather than reported per row -- there is nothing
 * the guild can do about a filter that no longer exists.
 */
export async function copyFilterExemptions(legacy: Database, tx: Executor): Promise<TableStat> {
	const rows = await legacy<{ channelId: string; guildId: string; value: string }[]>`
		SELECT "guild_id" AS guild_id, "channel_id" AS channel_id, "value" AS value
		FROM "filter_ignores"
		ORDER BY "guild_id", "channel_id"
	`;

	const values = rows.flatMap((row) =>
		decodeFilterIgnores(row.value).map((filter) => ({
			guildId: row.guildId,
			channelId: row.channelId,
			filter,
		})),
	);

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO automoderator_filter_exemptions ${tx(batch, 'guildId', 'channelId', 'filter')}
			ON CONFLICT (guild_id, channel_id, filter) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(values.length, inserted);
}

export async function copyAllowedUrls(legacy: Database, tx: Executor, context: CopyContext): Promise<TableStat> {
	const rows = await legacy<{ domain: string; guildId: string }[]>`
		SELECT "guild_id" AS guild_id, "domain" AS domain FROM "allowed_urls" ORDER BY "guild_id", "domain"
	`;

	const seen = new Set<string>();
	const values = rows.flatMap((row) => {
		const domain = normalizeLegacyDomain(row.domain);
		if (domain === null) {
			note(context, row.guildId, 'url allowlist', `dropped ${JSON.stringify(row.domain)}: not a domain`);
			return [];
		}

		// Lowercasing can collapse two legacy rows onto one target key, which the batch INSERT would hit as a
		// "cannot affect row a second time" error rather than an ON CONFLICT skip.
		const key = `${row.guildId}/${domain}`;
		if (seen.has(key)) {
			return [];
		}

		seen.add(key);

		if (isPublicSuffixLookalike(domain)) {
			note(
				context,
				row.guildId,
				'url allowlist',
				`${domain} looks like a registry suffix rather than a site -- legacy reduced every entry to two ` +
					'labels, so this allows every domain under it. Migrated as-is; worth raising with the guild',
			);
		}

		return [{ guildId: row.guildId, domain }];
	});

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO automoderator_allowed_urls ${tx(batch, 'guildId', 'domain')}
			ON CONFLICT (guild_id, domain) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

/**
 * The placeholder written into `automoderator_allowed_invites.name`.
 *
 * Legacy stored only the resolved guild id, and the name cannot be recovered: the allowlist names servers
 * AutoModerator is not in, `GET /guilds/{id}` needs membership, and there is no invite code left to resolve.
 * So the column gets a placeholder and the dashboard renders it like any other name -- re-adding the server
 * from the dashboard is what replaces it with the real one, which is the same refresh path an entry whose
 * name has since changed already uses.
 */
export const MIGRATED_INVITE_NAME = 'Unknown server (migrated)';

export async function copyAllowedInvites(legacy: Database, tx: Executor): Promise<TableStat> {
	const rows = await legacy<{ allowedGuildId: string; guildId: string }[]>`
		SELECT "guild_id" AS guild_id, "allowed_guild_id" AS allowed_guild_id
		FROM "allowed_invites"
		ORDER BY "guild_id", "allowed_guild_id"
	`;

	const values = rows.map((row) => ({
		guildId: row.guildId,
		allowedGuildId: row.allowedGuildId,
		name: MIGRATED_INVITE_NAME,
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO automoderator_allowed_invites ${tx(batch, 'guildId', 'allowedGuildId', 'name')}
			ON CONFLICT (guild_id, allowed_guild_id) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

export async function copyReportPresets(legacy: Database, tx: Executor): Promise<TableStat> {
	// Legacy had no unique constraint on `(guild_id, reason)`, so the same canned reason could be added
	// twice; the target's does, and `DO NOTHING` collapses them -- which is the intended outcome, since two
	// identical select options are two a reporter cannot tell apart. `DISTINCT` here as well, because a
	// same-batch duplicate would error rather than conflict.
	const rows = await legacy<{ guildId: string; reason: string }[]>`
		SELECT DISTINCT "guild_id" AS guild_id, "reason" AS reason
		FROM "preset_report_reasons"
		ORDER BY "guild_id", "reason"
	`;

	let inserted = 0;
	for (const batch of chunk(rows, BATCH_SIZE)) {
		const result = await tx<{ id: number }[]>`
			INSERT INTO automoderator_report_presets ${tx(batch, 'guildId', 'reason')}
			ON CONFLICT (guild_id, reason) DO NOTHING
			RETURNING id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

/**
 * Banned words, into the read-only archive rather than into anything that acts.
 *
 * The matching half of a legacy row can only live in a native AutoMod rule and this port never writes to
 * Discord's AutoMod, so the words themselves do not migrate -- each guild rebuilds its list in Server
 * Settings and attaches policies to it. That is only a reasonable thing to ask if they can still read what
 * the list used to be, and after P9 drops `postgres-old` this table is the only place it exists.
 */
export async function copyLegacyBanwords(legacy: Database, tx: Executor): Promise<TableStat> {
	const rows = await legacy<{ duration: string | null; flags: string; guildId: string; word: string }[]>`
		SELECT "guild_id" AS guild_id, "word" AS word, "flags" AS flags, "duration" AS duration
		FROM "banned_words"
		ORDER BY "guild_id", "word"
	`;

	const values = rows.map((row) => ({
		guildId: row.guildId,
		word: row.word,
		flags: decodeBanwordFlags(row.flags),
		durationSeconds: msToSeconds(row.duration),
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO automoderator_legacy_banwords ${tx(batch, 'guildId', 'word', 'flags', 'durationSeconds')}
			ON CONFLICT (guild_id, word) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

// ---------------------------------------------------------------------------
// The whole copy
// ---------------------------------------------------------------------------

export interface CopyResult {
	/**
	 * Cases that actually landed, as opposed to ones the mapping looked at. A re-run maps everything again
	 * and inserts none of it, and the two numbers are what tell those apart.
	 */
	readonly casesInserted: number;
	readonly prePardoned: number;
	readonly shifted: { guildId: string; offset: number; rows: number }[];
	readonly stats: Stats;
}

export async function copyAll(legacy: Database, tx: Executor, context: CopyContext): Promise<CopyResult> {
	const guildIds = await collectLegacyGuildIds(legacy);
	const ceilings = await collectLegacyCaseCeilings(legacy);
	const duplicatePlan = await planDuplicateCaseNumbers(legacy, ceilings);

	// Every guild that already has new-stack cases in a number range legacy is about to reuse. Done before
	// anything is inserted, so the unique constraint never sees a collision in the first place.
	const shifted: { guildId: string; offset: number; rows: number }[] = [];
	for (const state of await collectTargetCaseState(tx, guildIds)) {
		const offset = ceilings.get(state.guildId) ?? 0;
		if (offset === 0 || state.maxCaseId === 0) {
			continue;
		}

		const rows = await shiftTargetCases(legacy, tx, state.guildId, offset);
		if (rows > 0) {
			shifted.push({ guildId: state.guildId, offset, rows });
		}
	}

	const autoPardonDays = new Map(
		(
			await legacy<{ autoPardonWarnsAfter: number; guildId: string }[]>`
				SELECT "guild_id" AS guild_id, "auto_pardon_warns_after" AS auto_pardon_warns_after
				FROM "guild_settings"
				WHERE "auto_pardon_warns_after" IS NOT NULL AND "auto_pardon_warns_after" > 0
			`
		).map((row) => [row.guildId, Number(row.autoPardonWarnsAfter)]),
	);

	// Sequential and in this order on purpose: settings first because they carry the case-number ceiling every
	// migrated case depends on, and the rest one at a time because they share the single transaction this all
	// runs in -- concurrency would only interleave writes on one connection.
	const settings = await copyGuildSettings(legacy, tx, context, ceilings);
	const cases = await copyCases(legacy, tx, context, { autoPardonDays, duplicatePlan });

	const stats: Stats = {
		automoderator_guild_settings: settings,
		automoderator_cases: cases.stat,
		automoderator_warn_punishments: await copyWarnPunishments(legacy, tx, context),
		automoderator_trigger_punishments: await copyTriggerPunishments(legacy, tx, context),
		automoderator_log_webhooks: await copyLogWebhooks(legacy, tx, context),
		automoderator_bypass_roles: await copyBypassRoles(legacy, tx),
		automoderator_log_exemptions: await copyLogExemptions(legacy, tx),
		automoderator_filter_exemptions: await copyFilterExemptions(legacy, tx),
		automoderator_allowed_urls: await copyAllowedUrls(legacy, tx, context),
		automoderator_allowed_invites: await copyAllowedInvites(legacy, tx),
		automoderator_report_presets: await copyReportPresets(legacy, tx),
		automoderator_legacy_banwords: await copyLegacyBanwords(legacy, tx),
	};

	await syncCaseCeilings(tx, guildIds);

	return { casesInserted: cases.stat.inserted, prePardoned: cases.prePardoned, shifted, stats };
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export interface Preflight {
	errors: string[];
	warnings: string[];
}

/**
 * Everything that must hold, or be said out loud, before a single row is written.
 *
 * The `errors` here are narrow on purpose: an enum label this script has no mapping for, and nothing else.
 * Every other legacy shape that the target would reject -- an unrepresentable ladder rung, an anti-spam
 * threshold below two, a domain that is not a domain -- is handled by the mapping and reported as an
 * adjustment, because aborting a cutover over one guild's malformed row helps nobody.
 */
export async function preflight(legacy: Database, target: Executor, now: Date): Promise<Preflight> {
	const errors: string[] = [];
	const warnings: string[] = [];

	const badActions = await legacy<{ actionType: string; count: string }[]>`
		SELECT "action_type"::text AS action_type, COUNT(*) AS count
		FROM "cases"
		WHERE "action_type"::text <> ALL(${LEGACY_CASE_ACTIONS})
		GROUP BY "action_type"
	`;
	for (const row of badActions) {
		errors.push(`${row.count} case(s) carry action '${row.actionType}', which this script has no mapping for`);
	}

	const badLogTypes = await legacy<{ count: string; logType: string }[]>`
		SELECT "log_type"::text AS log_type, COUNT(*) AS count
		FROM "webhook_tokens"
		WHERE "log_type"::text <> ALL(${LEGACY_LOG_TYPES})
		GROUP BY "log_type"
	`;
	for (const row of badLogTypes) {
		errors.push(`${row.count} webhook(s) carry log type '${row.logType}', which this script has no mapping for`);
	}

	// Legacy's racy allocator, made visible. Nothing is lost -- `planDuplicateCaseNumbers` gives each later
	// duplicate a fresh number above its guild's ceiling -- but a case whose number changed is worth knowing
	// about, because the mod-log embed that announced it still says the old one.
	const duplicates = await legacy<{ groups: string; rows: string }[]>`
		SELECT COUNT(*) AS groups, COALESCE(SUM(n), 0) AS rows FROM (
			SELECT COUNT(*) - 1 AS n FROM "cases" GROUP BY "guild_id", "case_id" HAVING COUNT(*) > 1
		) d
	`;
	if (Number(duplicates[0]?.rows ?? 0) > 0) {
		warnings.push(
			`${duplicates[0]!.rows} case(s) across ${duplicates[0]!.groups} collision(s) share a case number with ` +
				'another case in the same guild (legacy had no unique constraint). Each later one is renumbered above ' +
				'its guild high-water mark rather than dropped',
		);
	}

	// Tempbans the new expiry sweep will lift within seconds of the bot starting. Every one of them is a
	// person legacy owed an unban and never delivered, so this is the sweep doing its job -- but it is also a
	// burst of real, visible unbans on cutover day, and the number is worth seeing in advance.
	const overdue = await legacy<{ count: string }[]>`
		SELECT COUNT(*) AS count
		FROM "cases" c
		INNER JOIN "timed_case_tasks" t ON t."case_id" = c."id"
		WHERE c."action_type" = 'ban' AND c."expires_at" IS NOT NULL AND c."expires_at" <= ${now}
	`;
	if (Number(overdue[0]?.count ?? 0) > 0) {
		warnings.push(
			`${overdue[0]!.count} temporary ban(s) are already past their expiry with legacy's task still pending. ` +
				'The new expiry sweep lifts these, and files an UNBAN case for each, within a minute of the bot starting',
		);
	}

	// Role mutes are dropped feature 21: the new bot only ever issues native timeouts, so nothing will
	// remove a mute role it never applied. The people holding one stay muted until a human takes it off.
	const roleMutes = await legacy<{ count: string; guilds: string }[]>`
		SELECT COUNT(*) AS count, COUNT(DISTINCT c."guild_id") AS guilds
		FROM "cases" c
		INNER JOIN "timed_case_tasks" t ON t."case_id" = c."id"
		WHERE c."action_type" = 'mute' AND c."useTimeouts" = false
	`;
	if (Number(roleMutes[0]?.count ?? 0) > 0) {
		warnings.push(
			`${roleMutes[0]!.count} outstanding role-mute(s) across ${roleMutes[0]!.guilds} guild(s) will never be ` +
				'lifted automatically -- role mutes are dropped feature 21 and the new bot only issues timeouts. Those ' +
				'members keep the role until somebody removes it by hand',
		);
	}

	// Lists longer than the dashboard will let a guild add to. Not an error: the rows are real configuration
	// and truncating somebody's allowlist is worse than an editor that says "you already have too many".
	// Written out per table rather than built from a table name, because a table name reaching a query
	// through string interpolation is the one shape postgres.js cannot parameterise.
	const capChecks: readonly (readonly [label: string, cap: number, query: Promise<{ count: string }[]>])[] = [
		[
			'allowed_urls',
			250,
			legacy`SELECT COUNT(*) AS count FROM (SELECT 1 FROM "allowed_urls" GROUP BY "guild_id" HAVING COUNT(*) > 250) x`,
		],
		[
			'allowed_invites',
			100,
			legacy`SELECT COUNT(*) AS count FROM (SELECT 1 FROM "allowed_invites" GROUP BY "guild_id" HAVING COUNT(*) > 100) x`,
		],
		[
			'bypass roles',
			25,
			legacy`SELECT COUNT(*) AS count FROM (SELECT 1 FROM "BypassRole" GROUP BY "guild_id" HAVING COUNT(*) > 25) x`,
		],
		[
			'log_ignores',
			100,
			legacy`SELECT COUNT(*) AS count FROM (SELECT 1 FROM "log_ignores" GROUP BY "guild_id" HAVING COUNT(*) > 100) x`,
		],
		[
			'warn ladder rungs',
			25,
			legacy`SELECT COUNT(*) AS count FROM (SELECT 1 FROM "warn_punishments" GROUP BY "guild_id" HAVING COUNT(*) > 25) x`,
		],
		[
			'trigger ladder rungs',
			25,
			legacy`SELECT COUNT(*) AS count FROM (SELECT 1 FROM "automod_punishments" GROUP BY "guild_id" HAVING COUNT(*) > 25) x`,
		],
	];

	for (const [label, cap, query] of capChecks) {
		const over = await query;
		if (Number(over[0]?.count ?? 0) > 0) {
			warnings.push(
				`${over[0]!.count} guild(s) have more than ${cap} ${label}, which is the cap the dashboard enforces on ` +
					'new entries. They migrate in full; those guilds just cannot add more until they prune',
			);
		}
	}

	// Reports do not migrate, and cannot: legacy's `reports` table has no guild column at all, which is the
	// bug the target's `guild_id` exists to fix. There is nothing to derive one from -- a message id does not
	// name a guild -- so an open legacy report queue simply ends at cutover.
	const [openReports] = await legacy<[{ count: string }]>`
		SELECT COUNT(*) AS count FROM "reports" WHERE "acknowledged_at" IS NULL
	`;
	if (Number(openReports!.count) > 0) {
		warnings.push(
			`${openReports!.count} legacy report(s) are still open. Reports do not migrate -- legacy's table has no ` +
				'guild column, so there is nothing to migrate them into. Those queues end at cutover',
		);
	}

	// Anything already on the new stack for these guilds. Every table but cases lets the target win, so this
	// is the list of guilds whose legacy configuration will *not* be applied.
	const guildIds = await collectLegacyGuildIds(legacy);
	const [existing] = await target<[Record<string, string>]>`
		SELECT
			(SELECT COUNT(*) FROM automoderator_guild_settings WHERE guild_id = ANY(${guildIds}))    AS guild_settings,
			(SELECT COUNT(*) FROM automoderator_cases WHERE guild_id = ANY(${guildIds}))             AS cases,
			(SELECT COUNT(*) FROM automoderator_warn_punishments WHERE guild_id = ANY(${guildIds}))  AS warn_punishments,
			(SELECT COUNT(*) FROM automoderator_log_webhooks WHERE guild_id = ANY(${guildIds}))      AS log_webhooks
	`;
	for (const [table, count] of Object.entries(existing!)) {
		if (Number(count) > 0) {
			const label = table.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
			warnings.push(
				`${count} automoderator_${label} row(s) already exist on the new stack for legacy guilds (canary ` +
					'testing). Existing rows win everywhere except case numbering, where the new-stack cases are shifted ' +
					'above the migrated ones instead',
			);
		}
	}

	return { errors, warnings };
}
