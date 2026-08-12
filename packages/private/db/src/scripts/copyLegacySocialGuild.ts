// One-off script: copy a *single* guild's Social data out of the legacy `ChatSift/Social` Postgres into
// this stack's schema under a *different* guild id (#343 P5). Built to stock a canary test guild with real
// leveling data -- a leaderboard, level distribution and interaction set that behave like production's,
// rather than the three rows a human can generate by hand.
//
// Usage (one of --dry-run/--live is required, so a bare invocation can't write):
//   LEGACY_DATABASE_URL=postgres://... yarn copy:legacy-social-guild --from <legacyGuildId> --to <guildId> --dry-run
//   LEGACY_DATABASE_URL=postgres://... yarn copy:legacy-social-guild --from <legacyGuildId> --to <guildId> --live
//
// Flags:
//   --from <id>   Legacy guild to read. Required.
//   --to <id>     Guild id to write the rows under. Required, and may equal --from.
//   --xp-only     Copy only `social_guild_settings` and `social_users` -- see "what to expect" below.
//   --dry-run     Do the whole thing in a transaction and roll it back, printing what it would have done.
//   --live        The same run, committed.
//
// THIS SCRIPT DELETES. `--to`'s existing rows in all six `social_*` tables are removed before the copy, so
// re-running it is a clean replace rather than a no-op. That is the whole point (you will want to re-run it
// as you fiddle), but it means a typo'd `--to` wipes that guild's Social data. Always `--dry-run` first: it
// prints the exact delete counts before anything is committed. A `--from` that names a guild with no XP is
// refused outright, since that combination can only ever empty `--to`.
//
// This is NOT `migrateLegacySocial.ts`, and the two are deliberately separate rather than one script with
// more flags. That one is the cutover: it touches every guild, never rewrites a guild id, and never deletes
// anything. Neither script's safety model survives being given the other's flags. What they *do* share is
// the legacy-to-new column mapping, which lives once in lib/legacySocial.ts.
//
// What to expect afterwards, since fidelity here is a mixed blessing:
//
//   * `social_users` is the payload, and it transfers perfectly. User ids are global, and the leaderboard
//     resolves names through `GET /users/{id}` (a global lookup, not a guild-member one), so the migrated
//     users render with real usernames and avatars even though none of them are members of `--to`.
//   * `social_channels`/`social_roles` reference ids in the *source* guild, so they match nothing in `--to`
//     and are inert -- harmless, but they will look like junk in the dashboard.
//   * `social_rewards` is the one actively annoying carry-over: those role ids do not exist in `--to`, so
//     the bot will fail to grant them on every level-up. Use `--xp-only` if you are here for the
//     leaderboard and not for reward behaviour.
//   * `social_interactions` arrive with `command_id = NULL`, exactly like a real migration. Run the
//     dashboard's interactions resync against `--to` and they become real commands in that guild.
//   * `public_leaderboard` is not copied and stays `false`. Turn it on yourself if you want to exercise the
//     unauthenticated page -- it publishes real usernames from the source guild, so that should be a
//     deliberate act rather than something a copy script decides for you.

import process from 'node:process';
import { createDb, type Database } from '../index.js';
import type { Executor, Stats } from './lib/legacySocial.js';
import {
	RollbackSignal,
	SNOWFLAKE_PATTERN,
	copyAll,
	copyGuildSettings,
	copyUsers,
	findConstraintViolations,
	printStats,
	resolveLegacyUrl,
	resolveTargetUrl,
} from './lib/legacySocial.js';

// Every table the copy writes, so the wipe and the copy can never drift apart on which tables they cover.
// `--xp-only` narrows the copy but deliberately NOT the wipe: leaving a previous full run's rewards behind
// while replacing the users under them is exactly the kind of half-state this script exists to avoid.
const SOCIAL_TABLES = [
	'social_guild_settings',
	'social_users',
	'social_channels',
	'social_roles',
	'social_rewards',
	'social_interactions',
] as const;

async function wipeGuild(tx: Executor, guildId: string): Promise<Record<string, number>> {
	const deleted: Record<string, number> = {};

	for (const table of SOCIAL_TABLES) {
		// The table name is interpolated as an identifier rather than a bound parameter (Postgres has no
		// parameter slot for one). It comes from the frozen literal list above and never from argv, so this
		// cannot be reached with attacker-controlled or typo'd input.
		const rows = await tx`DELETE FROM ${tx(table)} WHERE guild_id = ${guildId} RETURNING guild_id`;
		deleted[table] = rows.length;
	}

	return deleted;
}

interface Args {
	from: string;
	live: boolean;
	to: string;
	xpOnly: boolean;
}

function resolveArgs(): Args {
	const flags = process.argv.filter((argument) => ['--dry-run', '--live'].includes(argument));

	if (flags.length !== 1) {
		console.error('Pass exactly one of --dry-run (rehearse and roll back) or --live (commit)');
		process.exit(1);
	}

	// Read positionally rather than with a `--from=x` split so both spellings aren't half-supported; a flag
	// with nothing after it yields `undefined` and falls into the same error as omitting it.
	const readValue = (flag: string): string | undefined => {
		const index = process.argv.indexOf(flag);
		return index === -1 ? undefined : process.argv[index + 1];
	};

	const from = readValue('--from');
	const to = readValue('--to');

	for (const [flag, value] of [
		['--from', from],
		['--to', to],
	] as const) {
		if (!value || !SNOWFLAKE_PATTERN.test(value)) {
			console.error(`${flag} <guildId> is required and must be a snowflake (got ${JSON.stringify(value)})`);
			process.exit(1);
		}
	}

	return { from: from!, to: to!, live: flags[0] === '--live', xpOnly: process.argv.includes('--xp-only') };
}

const { from, to, live, xpOnly } = resolveArgs();

const legacy = createDb({ url: resolveLegacyUrl() });
const target = createDb({ url: resolveTargetUrl() });

/**
 * The whole run, returning the process exit code rather than calling `process.exit` itself -- so an abort
 * cannot lose the very message explaining it. See the matching comment in `migrateLegacySocial.ts`.
 */
async function run(): Promise<number> {
	console.log(
		`Mode: ${live ? 'live' : 'dry-run (everything below is rolled back)'}, ` +
			`${from} -> ${to}${xpOnly ? ', xp-only' : ''}`,
	);

	// The same CHECK-violation preflight the real migration runs, scoped to this guild. A dry run would
	// surface these anyway as a mid-transaction constraint error; this names the offending row instead.
	const violations = await findConstraintViolations(legacy, { onlyGuildId: from });
	if (violations.length > 0) {
		for (const violation of violations) {
			console.error(`ABORT ${violation}`);
		}

		return 1;
	}

	// Aborts rather than warns, and does so before the transaction opens. This script wipes `--to` before it
	// writes, so a mistyped `--from` is the one input that destroys data and replaces it with nothing --
	// and since the entire purpose here is stocking a guild with leveling data, "copy a guild that has
	// none" has no legitimate use to preserve. Deliberately no override flag: emptying the target is a
	// single DELETE if that is genuinely what someone wants.
	const [sourceSize] = await legacy<[{ count: string }]>`SELECT COUNT(*) FROM "User" WHERE "guildId" = ${from}`;
	if (Number(sourceSize!.count) === 0) {
		console.error(
			`ABORT legacy guild ${from} has no User rows — check --from. Refusing to continue, because this script ` +
				`deletes ${to}'s existing Social rows before copying and would leave it empty.`,
		);
		return 1;
	}

	let stats: Stats = {};
	let deleted: Record<string, number> = {};

	try {
		await target.begin(async (tx) => {
			// Same reasoning as the real migration: this transaction interleaves reads against the legacy
			// database, so it sits idle for stretches unrelated to how fast Postgres is, and a server-side
			// timeout would kill it partway through. `SET LOCAL` reverts on commit or rollback.
			await tx`SET LOCAL statement_timeout = 0`;
			await tx`SET LOCAL idle_in_transaction_session_timeout = 0`;

			deleted = await wipeGuild(tx, to);

			const options = { onlyGuildId: from, asGuildId: to };
			stats = xpOnly
				? {
						social_guild_settings: await copyGuildSettings(legacy, tx, options),
						social_users: await copyUsers(legacy, tx, options),
					}
				: await copyAll(legacy, tx, options);

			if (!live) {
				throw new RollbackSignal();
			}
		});
	} catch (error) {
		if (!(error instanceof RollbackSignal)) {
			throw error;
		}
	}

	// A dry run rolls all of this back, so it reports in the conditional -- "Deleted 21 rows" above a
	// "nothing was written" footer is the kind of contradiction an operator resolves by trusting the louder
	// half, and here the louder half is the one that reads as data loss.
	const deletedTotal = Object.values(deleted).reduce((sum, count) => sum + count, 0);
	console.log(`\n${live ? 'Deleted from' : 'Would delete from'} guild ${to}: ${deletedTotal} row(s)`);
	for (const [table, count] of Object.entries(deleted)) {
		if (count > 0) {
			console.log(`  ${table.padEnd(26)}${String(count).padStart(6)}`);
		}
	}

	printStats(stats);

	if (!xpOnly && (stats['social_rewards']?.inserted ?? 0) > 0) {
		console.log(
			`\nNote: ${stats['social_rewards']!.inserted} reward role(s) ${live ? 'were copied and reference' : 'would be copied, referencing'} ` +
				`roles in guild ${from}, which do not exist in ${to} — the bot will fail to grant them on level-up. ` +
				'Delete them from the dashboard, or re-run with --xp-only.',
		);
	}

	if ((stats['social_interactions']?.inserted ?? 0) > 0) {
		console.log(
			`\nNote: ${stats['social_interactions']!.inserted} interaction(s) ${live ? 'were' : 'would be'} copied with ` +
				`command_id = NULL. Run the interactions resync on ${to}'s dashboard to register them as real commands.`,
		);
	}

	console.log(live ? '\nCommitted.' : '\nRolled back — nothing was written. Re-run with --live to apply.');

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

// Assigned rather than `process.exit(exitCode)`, so pending stdout drains first. See `run`'s doc comment.
process.exitCode = exitCode;
