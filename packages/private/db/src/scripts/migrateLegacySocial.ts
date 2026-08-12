// One-off script: migrate leveling history and Social config out of the legacy `ChatSift/Social` Postgres
// and into this stack's schema (#343 P5). See docs/roadmap/10-social-port.md for the milestone context and
// schema.sql's Social section for the target shape.
//
// Usage (both flags are required -- there is no default mode, so a bare invocation can't touch prod):
//   LEGACY_DATABASE_URL=postgres://... yarn migrate:legacy-social --source <slug> --dry-run
//   LEGACY_DATABASE_URL=postgres://... yarn migrate:legacy-social --source <slug> --live
//   LEGACY_DATABASE_URL=postgres://... yarn migrate:legacy-social --source <slug> --verify
//
// --dry-run runs the *entire* migration inside a transaction and then rolls it back, so every CHECK and
// unique constraint is genuinely exercised against real data without writing anything. --live is
// byte-for-byte the same run, committed. --verify is read-only against both databases.
//
// Two things are deliberately NOT migrated, both documented at their mapping in lib/legacySocial.ts:
// `social_interactions.command_id` (written NULL; the P6 resync assigns real ids) and anything in Redis
// (the `leveling_tracking`/`leveling_ineligible` eligibility keys in legacy db 1), which is ephemeral by
// design -- worst case a user's XP cooldown resets once at cutover.
//
// How this differs from `migrateLegacyModmail.ts`, since they are otherwise siblings: every legacy Social
// primary key is a natural composite of snowflakes and names, so there are no ids to regenerate, no id maps
// to thread through, and no `migration_source` column. A re-run is therefore a safe no-op rather than a
// history-duplicating disaster -- every insert skips on its natural key and the printed stats show it as
// `skipped`. That is also why `--source` here is only a printed label (see `resolveArgs`).

import process from 'node:process';
import { createDb, type Database } from '../index.js';
import type { Executor, Stats } from './lib/legacySocial.js';
import {
	RollbackSignal,
	collectLegacyGuildIds,
	copyAll,
	findConstraintViolations,
	printStats,
	resolveLegacyUrl,
	resolveTargetUrl,
} from './lib/legacySocial.js';

// How many `social_users` rows `--verify` compares field-by-field. Every guild's row count and XP sum is
// reconciled regardless (one aggregate query per side); this is the deeper per-row comparison on top, and
// it exists because a sum can be matched by two rows that swapped XP with each other.
const VERIFY_SAMPLE_SIZE = 50;

type Mode = 'dry-run' | 'live' | 'verify';

/**
 * Everything that must hold before a single row is written. Anything in `errors` aborts the run outright;
 * `warnings` are printed and proceed.
 */
async function preflight(legacy: Database, target: Executor): Promise<{ errors: string[]; warnings: string[] }> {
	const errors: string[] = [];
	const warnings: string[] = [];

	errors.push(...(await findConstraintViolations(legacy, {})));

	const guildIds = await collectLegacyGuildIds(legacy);

	// The `= ANY(${guildIds})` lookups below need no "is the list empty" guard: postgres.js infers the
	// element type of an empty array fine, and `= ANY('{}')` is simply false for every row, so an empty
	// legacy database warns about nothing -- the correct answer, not a degenerate case.
	//
	// Unlike ModMail's, this is a *warning* rather than a re-run abort. Nothing here can be duplicated (see
	// the file header), so the only thing a pre-existing target row does is win: its guild's legacy rows are
	// skipped. At cutover that should be nothing at all, since Social isn't live on the new stack -- so
	// anything reported here means someone configured Social on the new stack ahead of the migration, and
	// their legacy XP will not land.
	const [existing] = await target<[Record<string, string>]>`
		SELECT
			(SELECT COUNT(*) FROM social_guild_settings WHERE guild_id = ANY(${guildIds})) AS social_guild_settings,
			(SELECT COUNT(*) FROM social_users WHERE guild_id = ANY(${guildIds}))          AS social_users,
			(SELECT COUNT(*) FROM social_channels WHERE guild_id = ANY(${guildIds}))       AS social_channels,
			(SELECT COUNT(*) FROM social_roles WHERE guild_id = ANY(${guildIds}))          AS social_roles,
			(SELECT COUNT(*) FROM social_rewards WHERE guild_id = ANY(${guildIds}))        AS social_rewards,
			(SELECT COUNT(*) FROM social_interactions WHERE guild_id = ANY(${guildIds}))   AS social_interactions
	`;

	for (const [table, count] of Object.entries(existing!)) {
		if (Number(count) > 0) {
			// The `postgres.camel` transform turns the snake_case aliases above into camelCase keys; undo that
			// so these read as the table names they actually are.
			const label = table.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
			warnings.push(
				`${count} ${label} row(s) already exist here for legacy guilds and will be left untouched — the ` +
					`corresponding legacy rows will be skipped, not merged`,
			);
		}
	}

	// Legacy's `/level` upserted a `User` row just for being looked up, so the legacy database carries rows
	// for people who never earned anything. They migrate (dropping them would make the XP sums disagree for
	// no benefit) but the leaderboard filters `xp > 0`, so say up front how many that is rather than leaving
	// it to be discovered as a gap between the migrated row count and what the dashboard shows.
	const [zeroXp] = await legacy<[{ count: string }]>`SELECT COUNT(*) FROM "User" WHERE "xp" = 0`;
	if (Number(zeroXp!.count) > 0) {
		warnings.push(
			`${zeroXp!.count} legacy User row(s) have xp = 0 (legacy's /level created a row on lookup). They migrate ` +
				`faithfully, but the leaderboard filters them out — expect its total to be lower than social_users`,
		);
	}

	return { errors, warnings };
}

/**
 * Read-only reconciliation across both databases.
 *
 * Migrated rows are identified by guild, which is sound here for the same reason the re-run guard is a
 * warning: every Social key is natural, so a legacy row and its migrated counterpart share one. This does
 * assume the target has not accepted new Social writes for these guilds since the migration ran, which is
 * exactly the situation during a cutover.
 */
async function runVerify(legacy: Database, target: Executor): Promise<boolean> {
	let ok = true;

	const report = (label: string, left: number, right: number): void => {
		const matched = left === right;
		ok &&= matched;
		console.log(`  ${matched ? 'OK  ' : 'FAIL'} ${label.padEnd(26)} legacy=${left} target=${right}`);
	};

	const guildIds = await collectLegacyGuildIds(legacy);

	console.log('\nRow counts');

	// Every one of these tables is self-cancelling under an ON CONFLICT DO NOTHING skip: a legacy row is
	// skipped precisely because a target row with the same natural key already exists, so the guild-scoped
	// target count still matches the legacy one. A skip is invisible here, correctly -- preflight is what
	// reports it, and the field-level comparisons below are what catch a skipped row whose *contents*
	// differ from the legacy one it stood in for.
	const [legacyCounts] = await legacy<[Record<string, string>]>`
		SELECT
			(SELECT COUNT(*) FROM "GuildSettings")      AS social_guild_settings,
			(SELECT COUNT(*) FROM "User")               AS social_users,
			(SELECT COUNT(*) FROM "Channel")            AS social_channels,
			(SELECT COUNT(*) FROM "Role")               AS social_roles,
			(SELECT COUNT(*) FROM "Reward")             AS social_rewards,
			(SELECT COUNT(*) FROM "SocialInteraction")  AS social_interactions
	`;

	const [targetCounts] = await target<[Record<string, string>]>`
		SELECT
			(SELECT COUNT(*) FROM social_guild_settings WHERE guild_id = ANY(${guildIds})) AS social_guild_settings,
			(SELECT COUNT(*) FROM social_users WHERE guild_id = ANY(${guildIds}))          AS social_users,
			(SELECT COUNT(*) FROM social_channels WHERE guild_id = ANY(${guildIds}))       AS social_channels,
			(SELECT COUNT(*) FROM social_roles WHERE guild_id = ANY(${guildIds}))          AS social_roles,
			(SELECT COUNT(*) FROM social_rewards WHERE guild_id = ANY(${guildIds}))        AS social_rewards,
			(SELECT COUNT(*) FROM social_interactions WHERE guild_id = ANY(${guildIds}))   AS social_interactions
	`;

	for (const [table, count] of Object.entries(legacyCounts!)) {
		const label = table.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
		report(label, Number(count), Number(targetCounts![table] ?? 0));
	}

	// Per-guild XP sums: the headline fidelity check for the one table too big to compare row by row. A
	// guild's total XP is the number a member would notice being wrong, and it catches a whole class of
	// mapping bugs (a dropped batch, a coalesced NULL, an off-by-one page) that matching row counts don't.
	console.log('\nPer-guild XP');

	const legacyXp = await legacy<{ guildId: string; total: string; users: string }[]>`
		SELECT "guildId" AS guild_id, COUNT(*) AS users, COALESCE(SUM("xp"), 0) AS total
		FROM "User" GROUP BY "guildId" ORDER BY "guildId"
	`;
	const targetXp = await target<{ guildId: string; total: string; users: string }[]>`
		SELECT guild_id, COUNT(*) AS users, COALESCE(SUM(xp), 0) AS total
		FROM social_users WHERE guild_id = ANY(${guildIds}) GROUP BY guild_id ORDER BY guild_id
	`;

	const targetXpByGuild = new Map(targetXp.map((row) => [row.guildId, row]));
	for (const row of legacyXp) {
		const mirror = targetXpByGuild.get(row.guildId);
		report(`${row.guildId} users`, Number(row.users), Number(mirror?.users ?? 0));
		report(`${row.guildId} xp`, Number(row.total), Number(mirror?.total ?? 0));
	}

	if (legacyXp.length === 0) {
		console.log('  (no legacy User rows)');
	}

	// The four config tables plus settings are small enough (bounded by guild count, not member count) to
	// compare in full rather than sample, so do that -- a sample would be strictly worse for the same cost.
	console.log('\nField-level comparison');
	compareSignatures(
		'social_guild_settings',
		await legacySettingsSignatures(legacy),
		await targetSettingsSignatures(target, guildIds),
		report,
	);
	compareSignatures(
		'social_channels',
		await legacyChannelSignatures(legacy),
		await targetChannelSignatures(target, guildIds),
		report,
	);
	compareSignatures(
		'social_roles',
		await legacyRoleSignatures(legacy),
		await targetRoleSignatures(target, guildIds),
		report,
	);
	compareSignatures(
		'social_rewards',
		await legacyRewardSignatures(legacy),
		await targetRewardSignatures(target, guildIds),
		report,
	);
	compareSignatures(
		'social_interactions',
		await legacyInteractionSignatures(legacy),
		await targetInteractionSignatures(target, guildIds),
		report,
	);

	// `social_users` is the one table sampled rather than compared whole.
	console.log('\nSampled social_users rows');
	const sample = await legacy<{ guildId: string; ignored: boolean; userId: string; xp: number }[]>`
		SELECT "guildId" AS guild_id, "userId" AS user_id, "xp" AS xp, "ignored" AS ignored
		FROM "User" ORDER BY random() LIMIT ${VERIFY_SAMPLE_SIZE}
	`;

	let sampleFailures = 0;
	for (const row of sample) {
		const [mirror] = await target<{ ignored: boolean; xp: number }[]>`
			SELECT xp, ignored FROM social_users WHERE guild_id = ${row.guildId} AND user_id = ${row.userId}
		`;

		// Optional chaining rather than a `mirror === undefined` guard: a missing row leaves both sides
		// `undefined`, which compares unequal to the legacy number/boolean and so fails exactly as it should.
		if (mirror?.xp !== row.xp || mirror?.ignored !== row.ignored) {
			sampleFailures += 1;
			console.log(
				`  FAIL ${row.guildId}/${row.userId} legacy=(xp ${row.xp}, ignored ${row.ignored}) ` +
					`target=${mirror ? `(xp ${mirror.xp}, ignored ${mirror.ignored})` : '(missing)'}`,
			);
		}
	}

	if (sampleFailures === 0) {
		console.log(`  OK   all ${sample.length} sampled row(s) match exactly`);
	} else {
		ok = false;
	}

	return ok;
}

/**
 * A row's contents flattened to one comparable string, keyed by its natural key.
 *
 * `JSON.stringify` rather than joining on a delimiter: it can't be made ambiguous by a delimiter character
 * turning up inside an interaction's content or name, and it renders NULL distinguishably from an empty
 * string -- which matters, since several of these columns are nullable and legacy stored both.
 */
type Signatures = Map<string, string>;

function signature(...fields: readonly unknown[]): string {
	return JSON.stringify(fields);
}

async function legacySettingsSignatures(legacy: Database): Promise<Signatures> {
	const rows = await legacy<
		{
			guildId: string;
			levelUpNotificationFallbackChannelId: string | null;
			levelUpNotificationMessage: string | null;
			levelUpNotificationMode: string;
			requiredMessages: number | null;
			requiredMessagesTimespan: number | null;
			requiredXpBase: number | null;
			requiredXpMultiplier: number | null;
			xpGain: number | null;
		}[]
	>`
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
		FROM "GuildSettings"
	`;

	return new Map(
		rows.map((row) => [
			row.guildId,
			// Uppercased inline to mirror deviation 1 -- comparing the raw legacy label against the migrated
			// one would fail on every single row, which is the reverse of useful.
			signature(
				row.requiredMessages,
				row.requiredMessagesTimespan,
				row.xpGain,
				row.requiredXpBase,
				row.requiredXpMultiplier,
				row.levelUpNotificationMode.toUpperCase(),
				row.levelUpNotificationFallbackChannelId,
				row.levelUpNotificationMessage,
			),
		]),
	);
}

async function legacyChannelSignatures(legacy: Database): Promise<Signatures> {
	const rows = await legacy<{ channelId: string; guildId: string; ignored: boolean; multiplier: number | null }[]>`
		SELECT "guildId" AS guild_id, "channelId" AS channel_id, "ignored" AS ignored, "multiplier" AS multiplier
		FROM "Channel"
	`;

	// `?? 1` mirrors deviation 2 for the same reason the uppercase above mirrors deviation 1.
	return new Map(
		rows.map((row) => [signature(row.guildId, row.channelId), signature(row.ignored, row.multiplier ?? 1)]),
	);
}

async function legacyRoleSignatures(legacy: Database): Promise<Signatures> {
	const rows = await legacy<{ guildId: string; multiplier: number | null; roleId: string }[]>`
		SELECT "guildId" AS guild_id, "roleId" AS role_id, "multiplier" AS multiplier FROM "Role"
	`;

	return new Map(rows.map((row) => [signature(row.guildId, row.roleId), signature(row.multiplier ?? 1)]));
}

async function legacyRewardSignatures(legacy: Database): Promise<Signatures> {
	const rows = await legacy<{ clean: boolean; guildId: string; level: number; roleId: string }[]>`
		SELECT "guildId" AS guild_id, "roleId" AS role_id, "level" AS level, "clean" AS clean FROM "Reward"
	`;

	return new Map(rows.map((row) => [signature(row.guildId, row.roleId), signature(row.level, row.clean)]));
}

async function legacyInteractionSignatures(legacy: Database): Promise<Signatures> {
	const rows = await legacy<
		{
			allowTargets: boolean;
			attachmentUrl: string | null;
			color: string | null;
			content: string;
			embed: boolean;
			guildId: string;
			name: string;
			plainContent: string | null;
			uses: number;
		}[]
	>`
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
		FROM "SocialInteraction"
	`;

	return new Map(
		rows.map((row) => [
			signature(row.guildId, row.name),
			signature(row.content, row.color, row.plainContent, row.attachmentUrl, row.uses, row.embed, row.allowTargets),
		]),
	);
}

/**
 * The target side of each `legacy*Signatures` map, built with the same key and field order.
 *
 * These are written out per table rather than derived from a column list, which is the point: reading one
 * next to its legacy counterpart is how a reviewer checks the mapping, and a clever generic version would
 * hide exactly the thing being verified.
 */
async function targetSettingsSignatures(target: Executor, guildIds: string[]): Promise<Signatures> {
	const rows = await target<
		{
			guildId: string;
			levelUpNotificationFallbackChannelId: string | null;
			levelUpNotificationMessage: string | null;
			levelUpNotificationMode: string;
			requiredMessages: number | null;
			requiredMessagesTimespan: number | null;
			requiredXpBase: number | null;
			requiredXpMultiplier: number | null;
			xpGain: number | null;
		}[]
	>`
		SELECT guild_id, required_messages, required_messages_timespan, xp_gain, required_xp_base,
			required_xp_multiplier, level_up_notification_mode::text, level_up_notification_fallback_channel_id,
			level_up_notification_message
		FROM social_guild_settings WHERE guild_id = ANY(${guildIds})
	`;

	return new Map(
		rows.map((row) => [
			row.guildId,
			signature(
				row.requiredMessages,
				row.requiredMessagesTimespan,
				row.xpGain,
				row.requiredXpBase,
				row.requiredXpMultiplier,
				row.levelUpNotificationMode,
				row.levelUpNotificationFallbackChannelId,
				row.levelUpNotificationMessage,
			),
		]),
	);
}

async function targetChannelSignatures(target: Executor, guildIds: string[]): Promise<Signatures> {
	const rows = await target<{ channelId: string; guildId: string; ignored: boolean; multiplier: number }[]>`
		SELECT guild_id, channel_id, ignored, multiplier FROM social_channels WHERE guild_id = ANY(${guildIds})
	`;

	return new Map(rows.map((row) => [signature(row.guildId, row.channelId), signature(row.ignored, row.multiplier)]));
}

async function targetRoleSignatures(target: Executor, guildIds: string[]): Promise<Signatures> {
	const rows = await target<{ guildId: string; multiplier: number; roleId: string }[]>`
		SELECT guild_id, role_id, multiplier FROM social_roles WHERE guild_id = ANY(${guildIds})
	`;

	return new Map(rows.map((row) => [signature(row.guildId, row.roleId), signature(row.multiplier)]));
}

async function targetRewardSignatures(target: Executor, guildIds: string[]): Promise<Signatures> {
	const rows = await target<{ clean: boolean; guildId: string; level: number; roleId: string }[]>`
		SELECT guild_id, role_id, level, clean FROM social_rewards WHERE guild_id = ANY(${guildIds})
	`;

	return new Map(rows.map((row) => [signature(row.guildId, row.roleId), signature(row.level, row.clean)]));
}

async function targetInteractionSignatures(target: Executor, guildIds: string[]): Promise<Signatures> {
	const rows = await target<
		{
			allowTargets: boolean;
			attachmentUrl: string | null;
			color: string | null;
			content: string;
			embed: boolean;
			guildId: string;
			name: string;
			plainContent: string | null;
			uses: number;
		}[]
	>`
		SELECT guild_id, name, content, color, plain_content, attachment_url, uses, embed, allow_targets
		FROM social_interactions WHERE guild_id = ANY(${guildIds})
	`;

	return new Map(
		rows.map((row) => [
			signature(row.guildId, row.name),
			signature(row.content, row.color, row.plainContent, row.attachmentUrl, row.uses, row.embed, row.allowTargets),
		]),
	);
}

/**
 * Diffs a legacy signature map against its target counterpart, reporting how many of the legacy rows found
 * an exact match. A row present in the target but absent from legacy is deliberately not an error here --
 * that is a guild that used Social on the new stack before the migration, which preflight already warned
 * about, and counting it as a failure would make the warning fire twice under a worse name.
 */
function compareSignatures(
	table: string,
	legacySignatures: Signatures,
	targetSignatures: Signatures,
	report: (label: string, left: number, right: number) => void,
): void {
	let matched = 0;
	const mismatches: string[] = [];
	for (const [key, expected] of legacySignatures) {
		const actual = targetSignatures.get(key);
		if (actual === expected) {
			matched += 1;
		} else {
			mismatches.push(`${key}: legacy=${expected} target=${actual ?? '(missing)'}`);
		}
	}

	report(table, legacySignatures.size, matched);

	// Cap the printed detail: a systematic mapping bug mismatches every row, and scrolling past thousands of
	// identical-shaped lines to reach the summary helps nobody.
	for (const mismatch of mismatches.slice(0, 10)) {
		console.log(`       ${mismatch}`);
	}

	if (mismatches.length > 10) {
		console.log(`       ... and ${mismatches.length - 10} more`);
	}
}

// Unlike ModMail's, this slug is *not* persisted -- there is no `migration_source` column on any Social
// table, because every Social key is natural and so a second run of any source skips rather than
// duplicates. It is kept, per docs/roadmap/10-social-port.md, purely so the two scripts' operator
// ergonomics are identical: the flag you type during the Social cutover is the flag you typed during the
// ModMail one, and it labels the run's output.
const SOURCE_PATTERN = /^[a-z0-9-]+$/u;

function resolveArgs(): { mode: Mode; source: string } {
	const flags = process.argv.filter((argument) => ['--dry-run', '--live', '--verify'].includes(argument));

	if (flags.length !== 1) {
		console.error(
			'Pass exactly one of --dry-run (rehearse and roll back), --live (commit), --verify (read-only reconcile)',
		);
		process.exit(1);
	}

	// Read positionally rather than with a `--source=x` split so both spellings aren't half-supported;
	// `--source` with nothing after it yields `undefined` and falls into the same error as omitting it.
	const sourceIndex = process.argv.indexOf('--source');
	const source = sourceIndex === -1 ? undefined : process.argv[sourceIndex + 1];

	if (!source || !SOURCE_PATTERN.test(source)) {
		console.error(
			`Pass --source <slug> naming the legacy deployment being migrated (e.g. --source public). Must match ` +
				`${SOURCE_PATTERN.source}. It labels this run's output; unlike the ModMail migration's, it is not ` +
				`recorded on any row.`,
		);
		process.exit(1);
	}

	return { mode: flags[0]!.slice(2) as Mode, source };
}

const { mode, source } = resolveArgs();

const legacy = createDb({ url: resolveLegacyUrl() });
const target = createDb({ url: resolveTargetUrl() });

let exitCode = 0;

try {
	if (mode === 'verify') {
		console.log(`Mode: verify (read-only), source: ${source}`);
		exitCode = (await runVerify(legacy, target)) ? 0 : 1;
	} else {
		console.log(`Mode: ${mode}${mode === 'dry-run' ? ' (everything below is rolled back)' : ''}, source: ${source}`);

		const { errors, warnings } = await preflight(legacy, target);

		for (const warning of warnings) {
			console.warn(`WARN  ${warning}`);
		}

		if (errors.length > 0) {
			for (const error of errors) {
				console.error(`ABORT ${error}`);
			}

			process.exit(1);
		}

		let stats: Stats = {};
		const startedAt = Date.now();

		try {
			await target.begin(async (tx) => {
				// The whole migration is one transaction, and it interleaves reads against the *legacy* database
				// between writes here -- so this connection sits idle for stretches that have nothing to do with
				// how fast Postgres is. A server-side `statement_timeout` or `idle_in_transaction_session_timeout`
				// would kill the transaction partway through and force the whole run to be restarted. `SET LOCAL`
				// scopes both to this transaction, so they revert on commit or rollback rather than leaking into
				// the pooled connection.
				await tx`SET LOCAL statement_timeout = 0`;
				await tx`SET LOCAL idle_in_transaction_session_timeout = 0`;

				stats = await copyAll(legacy, tx, {});

				if (mode === 'dry-run') {
					throw new RollbackSignal();
				}
			});
		} catch (error) {
			if (!(error instanceof RollbackSignal)) {
				throw error;
			}
		}

		printStats(stats);

		// The number that sizes the cutover window (P6 step 1). `social_users` is the only table of unknown
		// magnitude, so a dry-run's wall-clock is the only honest estimate there is.
		console.log(`\nWall-clock: ${((Date.now() - startedAt) / 1_000).toFixed(1)}s`);

		const [withInteractions] = await legacy<[{ count: string }]>`
			SELECT COUNT(DISTINCT "guildId") FROM "SocialInteraction"
		`;
		console.log(
			`\n${withInteractions!.count} guild(s) have social interactions, every one of them migrated with ` +
				`command_id = NULL by design.\nRun the interactions resync for each before their custom commands work ` +
				'again (P6 step 6) — until then dispatch falls back to a (guild_id, name) lookup.',
		);

		console.log(mode === 'dry-run' ? '\nRolled back — nothing was written.' : '\nCommitted.');
	}
} catch (error) {
	console.error(error);
	exitCode = 1;
} finally {
	await legacy.end();
	await target.end();
}

process.exit(exitCode);
