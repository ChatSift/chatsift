// Fills a guild with AutoModerator data so a fresh dev database is usable immediately, rather than needing a
// human to hand-generate a case list by banning people (docs/roadmap/11-automoderator-port.md, "Dev and test
// affordances"). Deferred out of P0 with one boolean to its name; it lands here with P1's cases and log
// channels, which is the first point at which there is anything worth seeding.
//
// Usage:
//   yarn seed:automoderator --guild <guildId>
//   yarn seed:automoderator --guild <guildId> --reset
//
// Flags:
//   --guild <id>  The guild to seed. Required.
//   --reset       Delete this guild's existing cases and log webhook first, so a re-run is a clean replace
//                 rather than another 12 cases appended to the last run's.
//
// Refuses to run when IS_PRODUCTION. This writes invented moderation history against real user ids, and a
// production guild's case list is a record people rely on.
//
// **Deliberately seeds dangling ids.** Two of the cases name channel/role ids that do not exist, and the log
// webhook row points at a channel id that was never real. That is the bug class the dashboard's selects have
// hit repeatedly (a config row outliving the Discord object it references), and it only shows up when the
// data contains one -- see the note in docs/roadmap/11-automoderator-port.md. The mod log will therefore
// 404 on first dispatch and self-heal by dropping the row, which is itself the behaviour worth exercising.

import process from 'node:process';
import { createDb, type Database } from '../index.js';

interface SeedCase {
	readonly action: string;
	readonly daysAgo: number;
	readonly dryRun?: boolean;
	readonly expiresInDays?: number;
	readonly modId: string | null;
	readonly modTag: string | null;
	readonly pardoned?: boolean;
	readonly reason: string | null;
	readonly refOffset?: number;
	readonly targetId: string;
	readonly targetTag: string;
}

// Ids are syntactically valid snowflakes that belong to nobody. The dashboard resolves them through
// `GET /users/{id}`, which 404s, so every one of these renders through the "unresolvable user" fallback --
// which is the path worth having populated, since a two-year-old ban's target has usually left.
const ALICE = '110000000000000001';
const BOB = '110000000000000002';
const CAROL = '110000000000000003';
const MOD_ONE = '120000000000000001';
const MOD_TWO = '120000000000000002';

const CASES: readonly SeedCase[] = [
	{
		action: 'WARN',
		targetId: ALICE,
		targetTag: 'alice',
		modId: MOD_ONE,
		modTag: 'moderator-one',
		reason: 'Spamming in #general',
		daysAgo: 30,
	},
	{
		action: 'WARN',
		targetId: ALICE,
		targetTag: 'alice',
		modId: MOD_ONE,
		modTag: 'moderator-one',
		reason: 'Second warning, same behaviour',
		daysAgo: 28,
		refOffset: 1,
	},
	// A pardoned warn: hidden from `/history` and from the case browser unless "include pardoned" is on, and
	// not counted toward P2's ladder.
	{
		action: 'WARN',
		targetId: BOB,
		targetTag: 'bob',
		modId: MOD_TWO,
		modTag: 'moderator-two',
		reason: 'Misread the situation',
		daysAgo: 25,
		pardoned: true,
	},
	{
		action: 'MUTE',
		targetId: ALICE,
		targetTag: 'alice',
		modId: MOD_ONE,
		modTag: 'moderator-one',
		reason: 'Escalating after two warnings',
		daysAgo: 20,
		expiresInDays: 1,
	},
	{
		action: 'UNMUTE',
		targetId: ALICE,
		targetTag: 'alice',
		modId: MOD_TWO,
		modTag: 'moderator-two',
		reason: 'Talked it through',
		daysAgo: 20,
	},
	{
		action: 'KICK',
		targetId: BOB,
		targetTag: 'bob',
		modId: MOD_ONE,
		modTag: 'moderator-one',
		reason: 'Advertising',
		daysAgo: 14,
	},
	{
		action: 'SOFTBAN',
		targetId: CAROL,
		targetTag: 'carol',
		modId: MOD_TWO,
		modTag: 'moderator-two',
		reason: 'Raid follow-up, clearing messages',
		daysAgo: 10,
	},
	{
		action: 'BAN',
		targetId: CAROL,
		targetTag: 'carol',
		modId: MOD_ONE,
		modTag: 'moderator-one',
		reason: 'Ban evasion',
		daysAgo: 7,
	},
	{
		action: 'UNBAN',
		targetId: CAROL,
		targetTag: 'carol',
		modId: MOD_ONE,
		modTag: 'moderator-one',
		reason: 'Appealed successfully',
		daysAgo: 3,
	},
	// Unattributed, as an observed manual action whose moderator could not be resolved. Exercises the
	// dashboard's "Not attributed" branch and the backfill that a `/case reason` edit performs.
	{ action: 'BAN', targetId: BOB, targetTag: 'bob', modId: null, modTag: null, reason: null, daysAgo: 2 },
	// A dry-run case: recorded, but nothing happened on Discord. Only reachable outside production, which is
	// exactly where this script runs.
	{
		action: 'BAN',
		targetId: ALICE,
		targetTag: 'alice',
		modId: MOD_TWO,
		modTag: 'moderator-two',
		reason: 'What a ban would look like',
		daysAgo: 1,
		dryRun: true,
	},
	{
		action: 'WARN',
		targetId: BOB,
		targetTag: 'bob',
		modId: MOD_TWO,
		modTag: 'moderator-two',
		reason: null,
		daysAgo: 0,
	},
];

/**
 * A channel id that does not exist, so the log config renders the dangling-reference path.
 */
const DANGLING_CHANNEL_ID = '130000000000000001';

function parseArgs(argv: readonly string[]): { guildId: string; reset: boolean } {
	const guildIndex = argv.indexOf('--guild');
	const guildId = guildIndex === -1 ? undefined : argv[guildIndex + 1];

	if (!guildId || !/^\d{17,20}$/.test(guildId)) {
		throw new Error('Usage: yarn seed:automoderator --guild <guildId> [--reset]');
	}

	return { guildId, reset: argv.includes('--reset') };
}

async function seed(db: Database, guildId: string, reset: boolean): Promise<void> {
	if (reset) {
		const deleted = await db`DELETE FROM automoderator_cases WHERE guild_id = ${guildId} RETURNING id`;
		await db`DELETE FROM automoderator_log_webhooks WHERE guild_id = ${guildId}`;
		// The counter is left where it is on purpose: case numbers are monotonic per guild and never reused,
		// so a reset that rewound it would hand the new rows numbers the old ones already used.
		console.log(`Reset: removed ${deleted.length} case(s) and any log webhook.`);
	}

	// Same allocator the bot uses, so the seeded numbers continue the guild's real sequence rather than
	// starting from 1 and colliding with whatever is already there.
	const numbers: number[] = [];
	for (const _ of CASES) {
		const [row] = await db<{ lastCaseId: number }[]>`
			INSERT INTO automoderator_guild_settings (guild_id, last_case_id)
			VALUES (${guildId}, 1)
			ON CONFLICT (guild_id) DO UPDATE SET last_case_id = automoderator_guild_settings.last_case_id + 1
			RETURNING last_case_id
		`;

		numbers.push(row!.lastCaseId);
	}

	const now = Date.now();
	for (const [index, seedCase] of CASES.entries()) {
		const createdAt = new Date(now - seedCase.daysAgo * 86_400_000);
		const caseNumber = numbers[index]!;
		// `refOffset` counts back through this batch, so a reference always points at a case this run created.
		const refId = seedCase.refOffset ? numbers[index - seedCase.refOffset] : null;

		await db`
			INSERT INTO automoderator_cases (
				guild_id, case_id, ref_id, target_id, target_tag, mod_id, mod_tag,
				action_type, reason, expires_at, pardoned_by, dry_run, created_at
			) VALUES (
				${guildId},
				${caseNumber},
				${refId ?? null},
				${seedCase.targetId},
				${seedCase.targetTag},
				${seedCase.modId},
				${seedCase.modTag},
				${seedCase.action}::automoderator_case_action,
				${seedCase.reason},
				${seedCase.expiresInDays ? new Date(createdAt.getTime() + seedCase.expiresInDays * 86_400_000) : null},
				${seedCase.pardoned ? MOD_ONE : null},
				${seedCase.dryRun ?? false},
				${createdAt}
			)
		`;
	}

	// A webhook id and token that were never real. The bot's first dispatch 404s and drops the row, which is
	// the self-heal path -- point the dashboard at a real channel to get a working log.
	await db`
		INSERT INTO automoderator_log_webhooks (guild_id, log_type, channel_id, webhook_id, webhook_token, thread_id)
		VALUES (${guildId}, 'MOD', ${DANGLING_CHANNEL_ID}, '140000000000000001', 'seeded-not-a-real-token', NULL)
		ON CONFLICT (guild_id, log_type) DO NOTHING
	`;

	console.log(`Seeded ${CASES.length} cases (#${numbers[0]}-#${numbers.at(-1)}) for guild ${guildId}.`);
	console.log(`Seeded a MOD log webhook pointing at a channel that does not exist (${DANGLING_CHANNEL_ID}).`);
}

// Destructured rather than accessed key-by-key: `ProcessEnv` is an index signature, so
// `noPropertyAccessFromIndexSignature` rejects dot access while eslint's `dot-notation` rejects bracket
// access. Destructuring is the one form both are happy with (same note as `lib/legacySocial.ts`).
const { IS_PRODUCTION, DATABASE_URL_DEV } = process.env;

const { guildId, reset } = parseArgs(process.argv.slice(2));

// Unlike the migration scripts, this one never resolves to `DATABASE_URL_PROD` at all -- it reads the dev URL
// or nothing. Seeding is invented data, and the safest shape for a script that invents moderation history is
// one that has no way to address production even if `IS_PRODUCTION` were set by accident.
if (IS_PRODUCTION && !['false', '0', 'no', 'off', 'n', 'disabled'].includes(IS_PRODUCTION.toLowerCase())) {
	console.error('seedAutomoderator refuses to run with IS_PRODUCTION set — this writes invented case history.');
	process.exit(1);
}

if (!DATABASE_URL_DEV) {
	console.error('DATABASE_URL_DEV is not set');
	process.exit(1);
}

const db = createDb({ url: DATABASE_URL_DEV });

try {
	await seed(db, guildId, reset);
} finally {
	await db.end();
}
