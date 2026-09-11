// One-off script: migrate moderation history and AutoModerator config out of the legacy `postgres-old`
// database (`ChatSift/AutoModerator`, `origin/v2`) and into this stack's schema (#11 P9). See
// docs/roadmap/11-automoderator-port.md for the milestone context and schema.sql's AutoModerator section for
// the target shape.
//
// Usage (the mode flag is required -- there is no default, so a bare invocation can't touch prod):
//   LEGACY_DATABASE_URL=postgres://... yarn migrate:legacy-automoderator --dry-run
//   LEGACY_DATABASE_URL=postgres://... yarn migrate:legacy-automoderator --live
//   LEGACY_DATABASE_URL=postgres://... yarn migrate:legacy-automoderator --verify
//
// --dry-run runs the *entire* migration inside a transaction and then rolls it back, so every CHECK and
// unique constraint is genuinely exercised against real data without writing anything. --live is
// byte-for-byte the same run, committed. --verify is read-only against both databases.
//
// Also needs ENCRYPTION_KEY (webhook tokens are encrypted at rest) and AUTOMODERATOR_BOT_TOKEN (only to
// derive the application id written into pre-pardoned warns). Running inside the already-running `api`
// container gives you all three plus IS_PRODUCTION/DATABASE_URL_PROD, which is why the runbook says to.
//
// **What does not migrate**, each for a reason that is not "we ran out of time":
//   * banned words -- the matching half can only live in a native AutoMod rule and this port never writes to
//     Discord's AutoMod. They go into `automoderator_legacy_banwords` instead, a read-only archive the
//     dashboard renders so a guild can rebuild its list, and which gets dropped three months after cutover.
//   * reports and reporters -- legacy's `reports` table has no guild column at all, so there is nothing to
//     migrate them into. Open queues end at cutover.
//   * filter trigger counts -- legacy's counter never decayed (its scheduler decayed a *different* table,
//     which it also deleted every tick), so a migrated tally would be a years-old cumulative number driving
//     a ladder that now escalates on it. Everyone starts at zero.
//   * self-assignable roles, mute roles, malicious URL/file lists, NSFW thresholds, mention config,
//     blank-avatar and forbidden-name settings, `apps`/`sigs`/`users`, and the `tasks` table -- dropped
//     features, or machinery the new stack replaced outright.
//
// How this differs from its two siblings: `migrateLegacyModmail.ts` regenerates ids and threads id maps
// through, and `migrateLegacySocial.ts` has only natural keys and so needs neither. This one is in between --
// `automoderator_cases.id` is allocated by the target and nothing references it, but `case_id` is a
// guild-scoped number moderators quote out loud, so it is preserved exactly and the *target's* existing
// cases are the ones that move when they collide. See `shiftTargetCases`.

import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createDb, type Database } from '../index.js';
import type { Adjustment, CopyContext } from './lib/legacyAutomoderator.js';
import { collectLegacyGuildIds, copyAll, decodeBanwordFlags, preflight } from './lib/legacyAutomoderator.js';
import type { Executor, Stats } from './lib/migrationCommon.js';
import {
	RollbackSignal,
	printStats,
	resolveEncryptionKey,
	resolveLegacyUrl,
	resolveTargetUrl,
} from './lib/migrationCommon.js';

/**
 * How many `automoderator_cases` rows `--verify` compares field-by-field. Every guild's case count and
 * highest case number is reconciled regardless (one aggregate query per side); this is the deeper per-row
 * comparison on top, and it exists because two matching counts can still describe different rows.
 */
const VERIFY_SAMPLE_SIZE = 100;

type Mode = 'dry-run' | 'live' | 'verify';

/**
 * The AutoModerator application id, taken from the bot token rather than asked for on the command line.
 *
 * A bot token's first dot-separated segment is the base64url-encoded application id -- no Discord call
 * needed, and no chance of the operator typing the wrong one into the field that decides who a pardoned warn
 * is attributed to. It is the same id the runtime sweep writes via `getSelfId`, so a warn this migration
 * pre-pardons is indistinguishable from one the sweep would have handled.
 */
function resolveApplicationId(): string {
	const { AUTOMODERATOR_BOT_TOKEN } = process.env;
	if (!AUTOMODERATOR_BOT_TOKEN) {
		console.error(
			'AUTOMODERATOR_BOT_TOKEN is required — its first segment is the application id, which is what pre-pardoned ' +
				'warns are attributed to. No Discord call is made with it.',
		);
		process.exit(1);
	}

	const [encoded] = AUTOMODERATOR_BOT_TOKEN.split('.');
	const decoded = Buffer.from(encoded ?? '', 'base64url').toString('utf8');

	if (!/^\d{17,20}$/u.test(decoded)) {
		console.error(
			`AUTOMODERATOR_BOT_TOKEN's first segment decodes to ${JSON.stringify(decoded)}, which is not a snowflake. ` +
				'Refusing to guess the application id.',
		);
		process.exit(1);
	}

	return decoded;
}

/**
 * Read-only reconciliation across both databases.
 *
 * Migrated rows are identified by guild, which is sound for the same reason the pre-existing-row guard is a
 * warning rather than an abort: every table but `automoderator_cases` has a natural key shared with its
 * legacy counterpart. Cases are reconciled on `(guild_id, case_id)`, which is preserved by design.
 *
 * This does assume the target has not accepted new AutoModerator writes for these guilds since the migration
 * ran, which is exactly the situation during a cutover -- and where it has, an *excess* is reported as WARN
 * rather than FAIL, because canary testing is a known and expected source of one.
 */
async function runVerify(legacy: Database, target: Executor): Promise<boolean> {
	let ok = true;

	const report = (label: string, left: number, right: number): void => {
		let status: string;
		if (right < left) {
			status = 'FAIL';
			ok = false;
		} else if (right > left) {
			status = 'WARN';
		} else {
			status = 'OK  ';
		}

		const excess = right > left ? ` (+${right - left} not from this migration)` : '';
		console.log(`  ${status} ${label.padEnd(34)} legacy=${left} target=${right}${excess}`);
	};

	const guildIds = await collectLegacyGuildIds(legacy);

	console.log('\nRow counts');

	// `filter_ignores` is deliberately absent: one legacy bitfield row becomes between zero and three target
	// rows, so its counts cannot match and a comparison here would be noise. The field-level check below is
	// what covers it.
	// The two ladder counts exclude the one shape this migration cannot represent -- a MUTE rung with no
	// duration, which a timeout has no form for and the target CHECK forbids. Excluded here rather than
	// footnoted below it, because a verifier that prints FAIL on a correct run is one an operator learns to
	// ignore, and the whole value of this pass is that red means red. `printDroppedRungs` states the number
	// separately so the exclusion is visible rather than silent.
	const [legacyCounts] = await legacy<[Record<string, string>]>`
		SELECT
			(SELECT COUNT(*) FROM "cases")                 AS cases,
			(SELECT COUNT(*) FROM "warn_punishments"
				WHERE NOT ("action_type" = 'mute' AND "duration" IS NULL))    AS warn_punishments,
			(SELECT COUNT(*) FROM "automod_punishments"
				WHERE NOT ("action_type" = 'mute' AND "duration" IS NULL))    AS trigger_punishments,
			(SELECT COUNT(*) FROM "webhook_tokens")        AS log_webhooks,
			(SELECT COUNT(*) FROM "BypassRole")            AS bypass_roles,
			(SELECT COUNT(*) FROM "log_ignores")           AS log_exemptions,
			(SELECT COUNT(*) FROM "allowed_invites")       AS allowed_invites,
			(SELECT COUNT(*) FROM "banned_words")          AS legacy_banwords
	`;

	const [targetCounts] = await target<[Record<string, string>]>`
		SELECT
			(SELECT COUNT(*) FROM automoderator_cases WHERE guild_id = ANY(${guildIds}))               AS cases,
			(SELECT COUNT(*) FROM automoderator_warn_punishments WHERE guild_id = ANY(${guildIds}))    AS warn_punishments,
			(SELECT COUNT(*) FROM automoderator_trigger_punishments WHERE guild_id = ANY(${guildIds})) AS trigger_punishments,
			(SELECT COUNT(*) FROM automoderator_log_webhooks WHERE guild_id = ANY(${guildIds}))        AS log_webhooks,
			(SELECT COUNT(*) FROM automoderator_bypass_roles WHERE guild_id = ANY(${guildIds}))        AS bypass_roles,
			(SELECT COUNT(*) FROM automoderator_log_exemptions WHERE guild_id = ANY(${guildIds}))      AS log_exemptions,
			(SELECT COUNT(*) FROM automoderator_allowed_invites WHERE guild_id = ANY(${guildIds}))     AS allowed_invites,
			(SELECT COUNT(*) FROM automoderator_legacy_banwords WHERE guild_id = ANY(${guildIds}))     AS legacy_banwords
	`;

	for (const [table, count] of Object.entries(legacyCounts!)) {
		const label = table.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
		report(label, Number(count), Number(targetCounts![table] ?? 0));
	}

	const [unrepresentable] = await legacy<[{ count: string }]>`
		SELECT (
			(SELECT COUNT(*) FROM "warn_punishments" WHERE "action_type" = 'mute' AND "duration" IS NULL) +
			(SELECT COUNT(*) FROM "automod_punishments" WHERE "action_type" = 'mute' AND "duration" IS NULL)
		) AS count
	`;
	if (Number(unrepresentable!.count) > 0) {
		console.log(
			`  NOTE ${unrepresentable!.count} ladder rung(s) are a MUTE with no duration, which a timeout cannot ` +
				'express. Dropped by design, and excluded from the two ladder counts above rather than left to read as ' +
				'a shortfall.',
		);
	}

	// Per-guild case counts and the highest number handed out. The count is what a moderator would notice
	// being wrong, and the ceiling is what the next case allocated in that guild depends on.
	console.log('\nPer-guild cases');

	const legacyCases = await legacy<{ cases: string; guildId: string; maxCaseId: string }[]>`
		SELECT "guild_id" AS guild_id, COUNT(*) AS cases, MAX("case_id") AS max_case_id
		FROM "cases" GROUP BY "guild_id" ORDER BY "guild_id"
	`;
	const targetCases = await target<{ cases: string; guildId: string; lastCaseId: string; maxCaseId: string }[]>`
		SELECT guild_id, COUNT(*) AS cases, MAX(case_id) AS max_case_id,
			(SELECT last_case_id FROM automoderator_guild_settings s WHERE s.guild_id = c.guild_id) AS last_case_id
		FROM automoderator_cases c WHERE guild_id = ANY(${guildIds}) GROUP BY guild_id ORDER BY guild_id
	`;

	const targetByGuild = new Map(targetCases.map((row) => [row.guildId, row]));
	for (const row of legacyCases) {
		const mirror = targetByGuild.get(row.guildId);
		report(`${row.guildId} cases`, Number(row.cases), Number(mirror?.cases ?? 0));

		// The ceiling must be at or above the highest number in the table, never below -- `allocateCaseNumber`
		// increments it and inserts, so a ceiling that has fallen behind produces a unique violation on the
		// guild's very next case. This is the one check whose failure is a live outage rather than a gap in
		// history, which is why it is asserted rather than merely counted.
		const lastCaseId = Number(mirror?.lastCaseId ?? 0);
		const maxCaseId = Number(mirror?.maxCaseId ?? 0);
		if (lastCaseId < maxCaseId) {
			ok = false;
			console.log(`  FAIL ${row.guildId} ceiling`.padEnd(41) + `last_case_id=${lastCaseId} < max case_id=${maxCaseId}`);
		}
	}

	if (legacyCases.length === 0) {
		console.log('  (no legacy cases)');
	}

	console.log('\nField-level comparison');
	compareSignatures(
		'warn_punishments',
		await legacyWarnSignatures(legacy),
		await targetWarnSignatures(target, guildIds),
		report,
	);
	compareSignatures(
		'bypass_roles',
		await legacyBypassSignatures(legacy),
		await targetBypassSignatures(target, guildIds),
		report,
	);
	compareSignatures(
		'log_webhooks',
		await legacyWebhookSignatures(legacy),
		await targetWebhookSignatures(target, guildIds),
		report,
	);
	compareSignatures(
		'filter_exemptions',
		await legacyFilterExemptionSignatures(legacy),
		await targetFilterExemptionSignatures(target, guildIds),
		report,
	);
	compareSignatures(
		'legacy_banwords',
		await legacyBanwordSignatures(legacy),
		await targetBanwordSignatures(target, guildIds),
		report,
	);

	// Cases are the one table sampled rather than compared whole.
	console.log('\nSampled cases');
	// Numbers legacy handed out twice are excluded: those are precisely the rows `planDuplicateCaseNumbers`
	// renumbered, so `(guild_id, case_id)` does not name the same case on both sides and every one of them
	// would report a mismatch that is the migration working as designed. Preflight is what surfaces them.
	const sample = await legacy<
		{ actionType: string; caseId: number; guildId: string; reason: string | null; targetId: string }[]
	>`
		SELECT "guild_id" AS guild_id, "case_id" AS case_id, "action_type"::text AS action_type,
			"target_id" AS target_id, "reason" AS reason
		FROM "cases"
		WHERE ("guild_id", "case_id") NOT IN (
			SELECT "guild_id", "case_id" FROM "cases" GROUP BY "guild_id", "case_id" HAVING COUNT(*) > 1
		)
		ORDER BY random() LIMIT ${VERIFY_SAMPLE_SIZE}
	`;

	let sampleFailures = 0;
	for (const row of sample) {
		const [mirror] = await target<{ actionType: string; reason: string | null; targetId: string }[]>`
			SELECT action_type, target_id, reason FROM automoderator_cases
			WHERE guild_id = ${row.guildId} AND case_id = ${row.caseId}
		`;

		if (
			mirror?.actionType !== row.actionType.toUpperCase() ||
			mirror.targetId !== row.targetId ||
			mirror.reason !== row.reason
		) {
			sampleFailures += 1;
			console.log(`  FAIL ${row.guildId}/#${row.caseId} does not match the migrated row`);
		}
	}

	if (sampleFailures === 0) {
		console.log(`  OK   all ${sample.length} sampled case(s) match exactly`);
	} else {
		ok = false;
	}

	return ok;
}

/**
 * A row's contents flattened to one comparable string, keyed by its natural key.
 *
 * `JSON.stringify` rather than joining on a delimiter: it can't be made ambiguous by a delimiter character
 * turning up inside a banned word or a reason, and it renders NULL distinguishably from an empty string.
 */
type Signatures = Map<string, string>;

function signature(...fields: readonly unknown[]): string {
	return JSON.stringify(fields);
}

function compareSignatures(
	label: string,
	left: Signatures,
	right: Signatures,
	report: (label: string, left: number, right: number) => void,
): void {
	let matched = 0;
	const mismatches: string[] = [];

	for (const [key, value] of left) {
		const mirror = right.get(key);
		if (mirror === value) {
			matched += 1;
		} else {
			mismatches.push(`${key}: legacy=${value} target=${mirror ?? '(missing)'}`);
		}
	}

	report(label, left.size, matched);

	// Capped, because a systematic mapping bug would otherwise print one line per row in the database.
	for (const mismatch of mismatches.slice(0, 10)) {
		console.log(`       ${mismatch}`);
	}

	if (mismatches.length > 10) {
		console.log(`       ... and ${mismatches.length - 10} more`);
	}
}

async function legacyWarnSignatures(legacy: Database): Promise<Signatures> {
	// Rungs this migration deliberately drops are excluded here too, or every run would report them as
	// mismatches -- the shortfall is already stated once, in the row counts above.
	const rows = await legacy<{ actionType: string; duration: string | null; guildId: string; warns: number }[]>`
		SELECT "guild_id" AS guild_id, "warns" AS warns, "action_type"::text AS action_type, "duration" AS duration
		FROM "warn_punishments"
		WHERE "warns" >= 1 AND NOT ("action_type" = 'mute' AND "duration" IS NULL)
	`;

	return new Map(
		rows.map((row) => [
			signature(row.guildId, row.warns),
			signature(row.actionType.toUpperCase(), expectedRungSeconds(row.actionType, row.duration)),
		]),
	);
}

/**
 * The duration a rung is expected to carry after mapping: milliseconds to seconds, clamped for a MUTE,
 * discarded for anything that carries none. Mirrors `mapRung`, for the same reason the Social verifier
 * mirrors its own deviations inline -- comparing the raw legacy value would fail on every row.
 */
function expectedRungSeconds(action: string, durationMs: string | null): number | null {
	if (action === 'kick' || action === 'warn') {
		return null;
	}

	if (durationMs === null) {
		return null;
	}

	const seconds = Number((BigInt(durationMs) + 999n) / 1_000n);
	if (seconds <= 0) {
		return null;
	}

	return action === 'mute' ? Math.min(seconds, 28 * 24 * 60 * 60) : seconds;
}

async function targetWarnSignatures(target: Executor, guildIds: string[]): Promise<Signatures> {
	const rows = await target<{ actionType: string; durationSeconds: number | null; guildId: string; warns: number }[]>`
		SELECT guild_id, warns, action_type, duration_seconds
		FROM automoderator_warn_punishments WHERE guild_id = ANY(${guildIds})
	`;

	return new Map(
		rows.map((row) => [signature(row.guildId, row.warns), signature(row.actionType, row.durationSeconds)]),
	);
}

async function legacyBypassSignatures(legacy: Database): Promise<Signatures> {
	const rows = await legacy<{ guildId: string; roleId: string }[]>`
		SELECT "guild_id" AS guild_id, "role_id" AS role_id FROM "BypassRole"
	`;

	return new Map(rows.map((row) => [signature(row.guildId, row.roleId), signature(true)]));
}

async function targetBypassSignatures(target: Executor, guildIds: string[]): Promise<Signatures> {
	const rows = await target<{ guildId: string; roleId: string }[]>`
		SELECT guild_id, role_id FROM automoderator_bypass_roles WHERE guild_id = ANY(${guildIds})
	`;

	return new Map(rows.map((row) => [signature(row.guildId, row.roleId), signature(true)]));
}

/**
 * Webhook tokens are compared by *presence*, not by value: the target's are encrypted with a random IV per
 * row, so the ciphertext of a correct migration never equals the plaintext it came from and could not be
 * compared without decrypting. What matters here is that the right webhook landed against the right channel
 * and log type -- the token's correctness is proven by the bot posting a log, which is operator verification.
 */
async function legacyWebhookSignatures(legacy: Database): Promise<Signatures> {
	const rows = await legacy<
		{ channelId: string; guildId: string; logType: string; threadId: string | null; webhookId: string }[]
	>`
		SELECT "guild_id" AS guild_id, "log_type"::text AS log_type, "channel_id" AS channel_id,
			"webhook_id" AS webhook_id, "thread_id" AS thread_id
		FROM "webhook_tokens"
	`;

	return new Map(
		rows.map((row) => [
			signature(row.guildId, row.logType.toUpperCase()),
			signature(row.channelId, row.webhookId, row.threadId),
		]),
	);
}

async function targetWebhookSignatures(target: Executor, guildIds: string[]): Promise<Signatures> {
	const rows = await target<
		{ channelId: string; guildId: string; logType: string; threadId: string | null; webhookId: string }[]
	>`
		SELECT guild_id, log_type, channel_id, webhook_id, thread_id
		FROM automoderator_log_webhooks WHERE guild_id = ANY(${guildIds})
	`;

	return new Map(
		rows.map((row) => [signature(row.guildId, row.logType), signature(row.channelId, row.webhookId, row.threadId)]),
	);
}

/**
 * The bitfield fan-out, checked in the direction that can actually be wrong: each (channel, filter) pair the
 * decode should have produced, against the row that should exist for it.
 */
async function legacyFilterExemptionSignatures(legacy: Database): Promise<Signatures> {
	const rows = await legacy<{ channelId: string; guildId: string; value: string }[]>`
		SELECT "guild_id" AS guild_id, "channel_id" AS channel_id, "value" AS value FROM "filter_ignores"
	`;

	const out: Signatures = new Map();
	for (const row of rows) {
		for (const filter of decodeExpectedFilters(row.value)) {
			out.set(signature(row.guildId, row.channelId, filter), signature(true));
		}
	}

	return out;
}

// Written out rather than imported from the mapping module on purpose: a verifier that reuses the code it is
// verifying only proves the code agrees with itself. The bit values are legacy's
// `BitField.makeFlags(['urls', 'files', 'invites', 'words', 'automod', 'global'])`.
function decodeExpectedFilters(value: string): string[] {
	const bits = BigInt(value);
	const out: string[] = [];
	if ((bits & 1n) === 1n) out.push('URLS');
	if ((bits & 4n) === 4n) out.push('INVITES');
	if ((bits & 16n) === 16n) out.push('ANTISPAM');
	return out;
}

async function targetFilterExemptionSignatures(target: Executor, guildIds: string[]): Promise<Signatures> {
	const rows = await target<{ channelId: string; filter: string; guildId: string }[]>`
		SELECT guild_id, channel_id, filter FROM automoderator_filter_exemptions WHERE guild_id = ANY(${guildIds})
	`;

	return new Map(rows.map((row) => [signature(row.guildId, row.channelId, row.filter), signature(true)]));
}

async function legacyBanwordSignatures(legacy: Database): Promise<Signatures> {
	const rows = await legacy<{ duration: string | null; flags: string; guildId: string; word: string }[]>`
		SELECT "guild_id" AS guild_id, "word" AS word, "flags" AS flags, "duration" AS duration FROM "banned_words"
	`;

	return new Map(
		rows.map((row) => [
			signature(row.guildId, row.word),
			signature(
				decodeBanwordFlags(row.flags),
				row.duration === null ? null : Number((BigInt(row.duration) + 999n) / 1_000n) || null,
			),
		]),
	);
}

async function targetBanwordSignatures(target: Executor, guildIds: string[]): Promise<Signatures> {
	const rows = await target<{ durationSeconds: number | null; flags: string[]; guildId: string; word: string }[]>`
		SELECT guild_id, word, flags, duration_seconds FROM automoderator_legacy_banwords WHERE guild_id = ANY(${guildIds})
	`;

	return new Map(rows.map((row) => [signature(row.guildId, row.word), signature(row.flags, row.durationSeconds)]));
}

function printAdjustments(adjustments: readonly Adjustment[]): void {
	if (adjustments.length === 0) {
		return;
	}

	console.log(`\nAdjustments (${adjustments.length}) — values this migration changed on the way through:`);
	for (const adjustment of adjustments) {
		console.log(`  ${adjustment.guildId}  ${adjustment.kind}: ${adjustment.detail}`);
	}
}

function resolveArgs(): Mode {
	const flags = process.argv.filter((arg) => ['--dry-run', '--live', '--verify'].includes(arg));

	if (flags.length !== 1) {
		console.error(
			'Pass exactly one of --dry-run (rehearse and roll back), --live (commit), --verify (read-only reconcile)',
		);
		process.exit(1);
	}

	return flags[0]!.slice(2) as Mode;
}

const mode = resolveArgs();

const legacy = createDb({ url: resolveLegacyUrl('ChatSift/AutoModerator') });
const target = createDb({ url: resolveTargetUrl() });

/**
 * The whole run, returning the process exit code rather than calling `process.exit` itself.
 *
 * That matters for more than tidiness: `process.exit` tears the process down without draining pending stdout
 * writes, which are asynchronous whenever output is a pipe -- and these scripts are routinely run piped
 * through `tail`/`grep`. An abort that exits immediately after printing its reason can therefore lose the
 * reason.
 */
async function run(): Promise<number> {
	if (mode === 'verify') {
		console.log('Mode: verify (read-only)');
		return (await runVerify(legacy, target)) ? 0 : 1;
	}

	// One instant for the whole run. Both the pre-pardon cutoff and the "has this tempban already expired"
	// decision read it, and a migration that takes minutes must not answer the same question two ways.
	const now = new Date();
	const context: CopyContext = {
		adjustments: [],
		encryptionKey: resolveEncryptionKey(),
		pardonActorId: resolveApplicationId(),
		now,
	};

	console.log(
		`Mode: ${mode}${mode === 'dry-run' ? ' (everything below is rolled back)' : ''}, ` +
			`pardon actor: ${context.pardonActorId}, as of ${now.toISOString()}`,
	);

	const { errors, warnings } = await preflight(legacy, target, now);

	for (const warning of warnings) {
		console.warn(`WARN  ${warning}`);
	}

	if (errors.length > 0) {
		for (const error of errors) {
			console.error(`ABORT ${error}`);
		}

		return 1;
	}

	let stats: Stats = {};
	let prePardoned = 0;
	let casesInserted = 0;
	let shifted: { guildId: string; offset: number; rows: number }[] = [];
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

			const result = await copyAll(legacy, tx, context);
			stats = result.stats;
			prePardoned = result.prePardoned;
			casesInserted = result.casesInserted;
			shifted = result.shifted;

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
	printAdjustments(context.adjustments);

	if (shifted.length > 0) {
		console.log(`\nRenumbered new-stack cases in ${shifted.length} guild(s) to make room for migrated numbering:`);
		for (const entry of shifted) {
			console.log(`  ${entry.guildId}  ${entry.rows} case(s) shifted by +${entry.offset}`);
		}

		console.log(
			'  Each shifted case keeps its old number in the mod-log embed that announced it, until somebody edits ' +
				'the case. These are canary-era test cases; migrated history keeps the numbers moderators know.',
		);
	}

	// Gated on rows actually landing, not on the mapping decision: a re-run maps every case again and skips
	// every insert, and reporting a pre-pardon count there would claim work that did not happen.
	if (prePardoned > 0 && casesInserted > 0) {
		console.log(
			`\nPre-pardoned ${prePardoned} warn(s) that were already past their guild's auto-pardon threshold. ` +
				"Legacy's sweep never fired (a cache-miss bug), so this is the backlog it owed — done here so the new " +
				'sweep has nothing to rewrite on cutover day.',
		);
	}

	// The number that sizes the cutover window. `cases` is the table of unknown magnitude, so a dry-run's
	// wall-clock is the only honest estimate there is.
	console.log(`\nWall-clock: ${((Date.now() - startedAt) / 1_000).toFixed(1)}s`);
	console.log(mode === 'dry-run' ? '\nRolled back — nothing was written.' : '\nCommitted.');

	return 0;
}

let exitCode = 0;

try {
	exitCode = await run();
} catch (error) {
	console.error(error);
	exitCode = 1;
} finally {
	await legacy.end();
	await target.end();
}

// Assigned rather than `process.exit(exitCode)`: both clients are closed above, so nothing holds the event
// loop open and Node exits on its own -- after stdout has drained. See `run`'s doc comment.
process.exitCode = exitCode;
