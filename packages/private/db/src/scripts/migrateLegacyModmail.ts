// One-off script: migrate ModMail history out of the legacy `ChatSift/ModMail` Postgres and into this
// stack's schema (#157). See docs/roadmap/06-modmail-port.md for the milestone context and
// docs/roadmap/01-architecture.md §6a for the target schema.
//
// Usage (both flags are required -- there is no default mode, so a bare invocation can't touch prod):
//   LEGACY_DATABASE_URL=postgres://... yarn migrate:legacy-modmail --source <slug> --dry-run
//   LEGACY_DATABASE_URL=postgres://... yarn migrate:legacy-modmail --source <slug> --live
//   LEGACY_DATABASE_URL=postgres://... yarn migrate:legacy-modmail --source <slug> --verify
//
// --dry-run runs the *entire* migration inside a transaction and then rolls it back, so every FK,
// CHECK and unique constraint is genuinely exercised against real data without writing anything.
// --live is byte-for-byte the same run, committed. --verify is read-only against both databases and
// reconciles row counts plus per-thread message sets (the tooling #158 wants).
//
// --source names the legacy deployment being migrated (e.g. `nascar`, `public`) and is written to
// `threads.migration_source`. There is more than one legacy database in the world: alongside the
// public `ChatSift/ModMail` deployment, partners self-host their own copies, and migrating one of
// those as a rehearsal must not wedge the public run later. Every "did I already migrate this?"
// question below -- the re-run guard and every target-side --verify count -- is scoped to this slug,
// so runs from different sources are fully independent while a second run of the *same* source is
// still refused.
//
// LEGACY_DATABASE_URL is read straight off the environment rather than added to
// `@chatsift/backend-core`'s `envSchema`: that schema is a top-level `.parse(process.env)` evaluated
// on import by every service, so a new required var there would break all of them for the sake of a
// script none of them run. This file deliberately imports nothing from backend-core at all.

import process from 'node:process';
import type postgres from 'postgres';
import { createDb, type Database } from '../index.js';

/**
 * The common supertype of the top-level client (`Database`) and a `sql.begin` transaction handle --
 * everything below only ever queries and builds fragments, so it accepts either rather than forcing
 * every helper to know which one it was handed.
 */
type Executor = postgres.ISql;

// Big enough that the round-trip count stays trivial for a dataset this size, small enough that a
// single INSERT's parameter list stays well clear of Postgres' 65535-parameter ceiling (the widest
// table here binds 10 columns per row).
const BATCH_SIZE = 1_000;

// How many threads `--verify` pulls full message sets for. Every thread's message *count* is checked
// regardless (one aggregate query per side); this is the deeper per-message id comparison on top.
const VERIFY_SAMPLE_SIZE = 25;

type Mode = 'dry-run' | 'live' | 'verify';

/**
 * Thrown to unwind out of `sql.begin` once a `--dry-run` has finished, so postgres.js issues a
 * ROLLBACK instead of a COMMIT. Caught and swallowed by the caller -- it is not a failure.
 */
class RollbackSignal extends Error {
	public constructor() {
		super('dry run complete, rolling back');
		this.name = 'RollbackSignal';
	}
}

/**
 * Legacy row shapes. Every query below aliases the legacy quoted-camelCase columns to snake_case so
 * the `postgres.camel` transform `createDb` applies hands them back as camelCase -- the aliases
 * double as an explicit, reviewable statement of the old-to-new column mapping.
 */
interface LegacyGuildSettings {
	alertRoleId: string | null;
	farewellMessage: string | null;
	greetingMessage: string | null;
	guildId: string;
	modmailChannelId: string | null;
	simpleMode: boolean;
}

interface LegacySnippet {
	commandId: string;
	content: string;
	createdAt: Date;
	createdById: string;
	guildId: string;
	lastUpdatedAt: Date;
	lastUsedAt: Date | null;
	name: string;
	snippetId: number;
	timesUsed: number;
}

interface LegacySnippetUpdate {
	oldContent: string;
	snippetId: number;
	snippetUpdateId: number;
	updatedAt: Date;
	updatedBy: string;
}

interface LegacyBlock {
	expiresAt: Date | null;
	guildId: string;
	userId: string;
}

interface LegacyThreadOpenAlert {
	guildId: string;
	userId: string;
}

interface LegacyThread {
	channelId: string;
	closedAt: Date | null;
	closedById: string | null;
	createdAt: Date;
	createdById: string;
	guildId: string;
	lastLocalThreadMessageId: number;
	threadId: number;
	userId: string;
}

interface LegacyThreadMessage {
	anon: boolean;
	guildId: string;
	guildMessageId: string;
	localThreadMessageId: number;
	staffId: string | null;
	threadId: number;
	threadMessageId: number;
	userId: string;
	userMessageId: string;
}

interface LegacyThreadReplyAlert {
	threadId: number;
	userId: string;
}

interface LegacyScheduledThreadClose {
	closeAt: Date;
	scheduledById: string;
	silent: boolean;
	threadId: number;
}

interface TableStat {
	inserted: number;
	read: number;
	skipped: number;
}

type Stats = Record<string, TableStat>;

function chunk<TItem>(items: readonly TItem[], size: number): TItem[][] {
	const out: TItem[][] = [];
	for (let index = 0; index < items.length; index += size) {
		out.push(items.slice(index, index + size));
	}

	return out;
}

/**
 * Pulls `count` ids off a table's identity sequence up front, so the legacy-id to new-id map exists
 * before a single row is written (which is what lets `--dry-run` produce the real mapping) and so
 * the sequence advances itself -- no `setval()` fixup is needed afterwards, unlike a migration that
 * inserts explicit ids taken from the source. Same `nextval(pg_get_serial_sequence(...))` reservation
 * services/modmail-bot's `lib/ticketCreation.ts` already does for a single ticket.
 *
 * Sequence gaps (from a rolled-back dry run, or from a row that hits ON CONFLICT DO NOTHING) are a
 * normal cost of `GENERATED BY DEFAULT AS IDENTITY` and nothing in this schema depends on ids being
 * contiguous.
 */
async function reserveIds(sql: Executor, table: string, column: string, count: number): Promise<number[]> {
	if (count === 0) {
		return [];
	}

	const rows = await sql<{ id: string }[]>`
		SELECT nextval(pg_get_serial_sequence(${table}, ${column})) AS id
		FROM generate_series(1, ${count})
	`;

	return rows.map((row) => Number(row.id));
}

function statFor(read: number, inserted: number): TableStat {
	return { read, inserted, skipped: read - inserted };
}

async function migrateGuildSettings(legacy: Database, tx: Executor): Promise<TableStat> {
	const rows = await legacy<LegacyGuildSettings[]>`
		SELECT
			"guildId"          AS guild_id,
			"modmailChannelId" AS modmail_channel_id,
			"greetingMessage"  AS greeting_message,
			"farewellMessage"  AS farewell_message,
			"simpleMode"       AS simple_mode,
			"alertRoleId"      AS alert_role_id
		FROM "GuildSettings"
		ORDER BY "guildId"
	`;

	if (rows.length === 0) {
		return statFor(0, 0);
	}

	// `mod_forum_id` is deliberately not in the column list: legacy `modmailChannelId` was a plain text
	// channel (the old bot opened threads inside it), and the new mod side requires a Forum for
	// tag-based category routing. Nothing validates that at the DB or bot layer -- only
	// services/api's updateConfig.ts checks `ChannelType.GuildForum` -- so writing the old value here
	// would produce a config that inserts cleanly and then fails at first ticket creation. Leaving it
	// NULL makes the guild visibly unconfigured, which the migration announcement already primes
	// admins for. Preflight prints exactly which guilds this affects.
	const values = rows.map((row) => ({
		guildId: row.guildId,
		defaultGreetingMessage: row.greetingMessage,
		farewellMessage: row.farewellMessage,
		// Carried for fidelity only -- `simple_mode` is stored and echoed by the API but read by
		// nothing in services/modmail-bot.
		simpleMode: row.simpleMode,
		alertRoleId: row.alertRoleId,
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO guild_settings ${tx(batch, 'guildId', 'defaultGreetingMessage', 'farewellMessage', 'simpleMode', 'alertRoleId')}
			ON CONFLICT (guild_id) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

async function migrateSnippets(legacy: Database, tx: Executor): Promise<[TableStat, Map<number, number>]> {
	const rows = await legacy<LegacySnippet[]>`
		SELECT
			"snippetId"     AS snippet_id,
			"guildId"       AS guild_id,
			"commandId"     AS command_id,
			"createdById"   AS created_by_id,
			"name"          AS name,
			"content"       AS content,
			"timesUsed"     AS times_used,
			"lastUsedAt"    AS last_used_at,
			"createdAt"     AS created_at,
			"lastUpdatedAt" AS last_updated_at
		FROM "Snippet"
		ORDER BY "snippetId"
	`;

	const idMap = new Map<number, number>();
	if (rows.length === 0) {
		return [statFor(0, 0), idMap];
	}

	// `command_id` migrates verbatim: the public cutover keeps the legacy Discord application and
	// token, and a guild command id is only ever valid under the application that created it. Had the
	// cutover minted a new application, every one of these would be a dead id and the guilds would
	// need a pass through services/api's resync route before their snippets were invokable again.
	const ids = await reserveIds(tx, 'snippets', 'id', rows.length);
	const values = rows.map((row, index) => ({
		id: ids[index]!,
		legacyId: row.snippetId,
		guildId: row.guildId,
		commandId: row.commandId,
		createdById: row.createdById,
		name: row.name,
		content: row.content,
		timesUsed: row.timesUsed,
		lastUsedAt: row.lastUsedAt,
		createdAt: row.createdAt,
		lastUpdatedAt: row.lastUpdatedAt,
	}));

	const byNewId = new Map(values.map((value) => [value.id, value.legacyId]));

	for (const batch of chunk(values, BATCH_SIZE)) {
		// A guild that already created a snippet of the same name on the new stack keeps its own --
		// the returned ids are how we learn which legacy rows actually landed, so a skipped snippet's
		// `SnippetUpdates` get dropped alongside it rather than orphaning against a missing FK.
		const result = await tx<{ id: number }[]>`
			INSERT INTO snippets ${tx(batch, 'id', 'guildId', 'commandId', 'createdById', 'name', 'content', 'timesUsed', 'lastUsedAt', 'createdAt', 'lastUpdatedAt')}
			ON CONFLICT (guild_id, name) DO NOTHING
			RETURNING id
		`;

		for (const { id } of result) {
			idMap.set(byNewId.get(id)!, id);
		}
	}

	return [statFor(rows.length, idMap.size), idMap];
}

async function migrateSnippetUpdates(
	legacy: Database,
	tx: Executor,
	snippetIds: Map<number, number>,
): Promise<TableStat> {
	const rows = await legacy<LegacySnippetUpdate[]>`
		SELECT
			"snippetUpdateId" AS snippet_update_id,
			"snippetId"       AS snippet_id,
			"updatedAt" AT TIME ZONE 'UTC' AS updated_at,
			"updatedBy"       AS updated_by,
			"oldContent"      AS old_content
		FROM "SnippetUpdates"
		ORDER BY "snippetUpdateId"
	`;

	const values = rows.flatMap((row) => {
		const snippetId = snippetIds.get(row.snippetId);
		return snippetId === undefined
			? []
			: [{ snippetId, updatedAt: row.updatedAt, updatedBy: row.updatedBy, oldContent: row.oldContent }];
	});

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ id: number }[]>`
			INSERT INTO snippet_updates ${tx(batch, 'snippetId', 'updatedAt', 'updatedBy', 'oldContent')}
			RETURNING id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

async function migrateBlocks(legacy: Database, tx: Executor): Promise<TableStat> {
	const rows = await legacy<LegacyBlock[]>`
		SELECT
			"userId"  AS user_id,
			"guildId" AS guild_id,
			"expiresAt" AT TIME ZONE 'UTC' AS expires_at
		FROM "Block"
		ORDER BY "guildId", "userId"
	`;

	let inserted = 0;
	for (const batch of chunk(rows, BATCH_SIZE)) {
		const result = await tx<{ userId: string }[]>`
			INSERT INTO blocks ${tx(batch, 'userId', 'guildId', 'expiresAt')}
			ON CONFLICT (user_id, guild_id) DO NOTHING
			RETURNING user_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

async function migrateThreadOpenAlerts(legacy: Database, tx: Executor): Promise<TableStat> {
	// Migrated for completeness only. `thread_open_alerts` is dead in the new stack -- the table and
	// its generated type exist, but nothing in services/, apps/ or packages/ reads or writes it.
	const rows = await legacy<LegacyThreadOpenAlert[]>`
		SELECT "guildId" AS guild_id, "userId" AS user_id
		FROM "ThreadOpenAlert"
		ORDER BY "guildId", "userId"
	`;

	let inserted = 0;
	for (const batch of chunk(rows, BATCH_SIZE)) {
		const result = await tx<{ guildId: string }[]>`
			INSERT INTO thread_open_alerts ${tx(batch, 'guildId', 'userId')}
			ON CONFLICT (guild_id, user_id) DO NOTHING
			RETURNING guild_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

async function migrateThreads(
	legacy: Database,
	tx: Executor,
	source: string,
): Promise<[TableStat, Map<number, number>]> {
	const rows = await legacy<LegacyThread[]>`
		SELECT
			"threadId"                 AS thread_id,
			"guildId"                  AS guild_id,
			"channelId"                AS channel_id,
			"userId"                   AS user_id,
			"createdById"              AS created_by_id,
			"createdAt"                AS created_at,
			"closedById"               AS closed_by_id,
			"closedAt"                 AS closed_at,
			"lastLocalThreadMessageId" AS last_local_thread_message_id
		FROM "Thread"
		ORDER BY "threadId"
	`;

	const idMap = new Map<number, number>();
	if (rows.length === 0) {
		return [statFor(0, 0), idMap];
	}

	const ids = await reserveIds(tx, 'threads', 'id', rows.length);

	// `category_id` and `user_channel_id` are both left NULL: a legacy ticket had no category concept,
	// and its DM channel is not something the new bot should ever lock or delete (it was never a
	// private thread this bot created).
	//
	// `origin` is 'dm' rather than the column default 'panel', and that is load-bearing rather than
	// cosmetic: services/modmail-bot's `lib/preventThreadArchive.ts` selects
	// `WHERE closed_at IS NULL AND origin != 'dm'` and force-stamps `closed_at = now()` on any row
	// whose `mod_thread_id` 404s. Every migrated row is closed (preflight refuses to run otherwise),
	// so it cannot fire either way -- 'dm' makes that true by construction instead of by luck, and is
	// also just historically accurate. It is *only* that, though: `migration_source` below is what
	// marks a row as migrated, so nothing here depends on 'dm' being unique to migrated rows.
	const values = rows.map((row, index) => ({
		id: ids[index]!,
		guildId: row.guildId,
		modThreadId: row.channelId,
		userId: row.userId,
		createdById: row.createdById,
		createdAt: row.createdAt,
		closedById: row.closedById,
		closedAt: row.closedAt,
		lastLocalThreadMessageId: row.lastLocalThreadMessageId,
		origin: 'dm',
		migrationSource: source,
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		// No unique constraint on `threads`, so a conflict here is impossible and deliberately not
		// swallowed -- if one ever surfaces it is a bug worth seeing, not a row to skip.
		const result = await tx<{ id: number }[]>`
			INSERT INTO threads ${tx(batch, 'id', 'guildId', 'modThreadId', 'userId', 'createdById', 'createdAt', 'closedById', 'closedAt', 'lastLocalThreadMessageId', 'origin', 'migrationSource')}
			RETURNING id
		`;
		inserted += result.length;
	}

	for (const [index, row] of rows.entries()) {
		idMap.set(row.threadId, ids[index]!);
	}

	return [statFor(rows.length, inserted), idMap];
}

async function migrateThreadMessages(
	legacy: Database,
	tx: Executor,
	threadIds: Map<number, number>,
): Promise<TableStat> {
	// Keyset-paginated rather than read whole: this is far and away the largest table, and there is no
	// reason to hold years of message rows in memory at once when they are written straight through.
	let cursor = 0;
	let read = 0;
	let inserted = 0;

	for (;;) {
		const rows = await legacy<LegacyThreadMessage[]>`
			SELECT
				"threadMessageId"      AS thread_message_id,
				"localThreadMessageId" AS local_thread_message_id,
				"guildId"              AS guild_id,
				"threadId"             AS thread_id,
				"userId"               AS user_id,
				"userMessageId"        AS user_message_id,
				"staffId"              AS staff_id,
				"guildMessageId"       AS guild_message_id,
				"anon"                 AS anon
			FROM "ThreadMessage"
			WHERE "threadMessageId" > ${cursor}
			ORDER BY "threadMessageId"
			LIMIT ${BATCH_SIZE}
		`;

		if (rows.length === 0) {
			break;
		}

		read += rows.length;
		cursor = rows.at(-1)!.threadMessageId;

		// `is_internal`/`is_system` stay false and `deleted_at` NULL -- none of that context was ever
		// recorded historically, and "not recorded" is the accurate state rather than a gap to guess at.
		// No `thread_message_content` rows are written either: content recording (#261) did not exist,
		// and the dashboard already renders exactly this case as a "Not recorded" placeholder.
		//
		// `guild_message_id` is preserved verbatim because the dashboard derives every rendered
		// timestamp from that snowflake rather than from any stored date.
		const values = rows.map((row) => ({
			localThreadMessageId: row.localThreadMessageId,
			guildId: row.guildId,
			threadId: threadIds.get(row.threadId)!,
			userId: row.userId,
			userMessageId: row.userMessageId,
			staffId: row.staffId,
			guildMessageId: row.guildMessageId,
			anon: row.anon,
		}));

		const result = await tx<{ id: number }[]>`
			INSERT INTO thread_messages ${tx(values, 'localThreadMessageId', 'guildId', 'threadId', 'userId', 'userMessageId', 'staffId', 'guildMessageId', 'anon')}
			RETURNING id
		`;
		inserted += result.length;
	}

	return statFor(read, inserted);
}

async function migrateThreadReplyAlerts(
	legacy: Database,
	tx: Executor,
	threadIds: Map<number, number>,
): Promise<TableStat> {
	const rows = await legacy<LegacyThreadReplyAlert[]>`
		SELECT "threadId" AS thread_id, "userId" AS user_id
		FROM "ThreadReplyAlert"
		ORDER BY "threadId", "userId"
	`;

	const values = rows.map((row) => ({ threadId: threadIds.get(row.threadId)!, userId: row.userId }));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ userId: string }[]>`
			INSERT INTO thread_reply_alerts ${tx(batch, 'threadId', 'userId')}
			RETURNING user_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

async function migrateScheduledThreadCloses(
	legacy: Database,
	tx: Executor,
	threadIds: Map<number, number>,
): Promise<TableStat> {
	// Inert once migrated -- every thread here is closed and `scheduledCloseSweep` only ever looks at
	// `closed_at IS NULL` rows. Carried anyway so reconciliation stays a uniform "every table matches"
	// rather than having one table everyone has to remember is intentionally empty.
	const rows = await legacy<LegacyScheduledThreadClose[]>`
		SELECT
			"threadId"      AS thread_id,
			"scheduledById" AS scheduled_by_id,
			"silent"        AS silent,
			"closeAt" AT TIME ZONE 'UTC' AS close_at
		FROM "ScheduledThreadClose"
		ORDER BY "threadId"
	`;

	const values = rows.map((row) => ({
		threadId: threadIds.get(row.threadId)!,
		scheduledById: row.scheduledById,
		silent: row.silent,
		closeAt: row.closeAt,
	}));

	let inserted = 0;
	for (const batch of chunk(values, BATCH_SIZE)) {
		const result = await tx<{ threadId: number }[]>`
			INSERT INTO scheduled_thread_closes ${tx(batch, 'threadId', 'scheduledById', 'silent', 'closeAt')}
			RETURNING thread_id
		`;
		inserted += result.length;
	}

	return statFor(rows.length, inserted);
}

/**
 * Every guild id appearing anywhere in the legacy database -- the set of guilds this migration touches.
 *
 * It has to union *all five* guild-carrying tables, not just `GuildSettings` and `Thread`. Nothing in
 * either schema ties a `Block`, `ThreadOpenAlert` or `Snippet` to a settings row or a thread (no FKs,
 * and the legacy bot could block a user in a guild that never finished configuring), and every
 * `migrate*` function above copies its table wholesale rather than filtering by guild. Deriving a
 * narrower set here would make `--verify` compare an unfiltered legacy `COUNT(*)` against a
 * guild-filtered target count and report a false `FAIL` on a perfectly good migration -- exactly the
 * kind of thing that makes a reconciliation tool worthless during a cutover.
 *
 * `ThreadMessage` is deliberately absent: its `guildId` always matches its parent `Thread`, which is
 * already covered. `ThreadReplyAlert`/`ScheduledThreadClose` carry no `guildId` at all.
 */
async function collectLegacyGuildIds(legacy: Database): Promise<string[]> {
	const rows = await legacy<{ guildId: string }[]>`
		SELECT "guildId" AS guild_id FROM "GuildSettings"
		UNION SELECT "guildId" AS guild_id FROM "Thread"
		UNION SELECT "guildId" AS guild_id FROM "Block"
		UNION SELECT "guildId" AS guild_id FROM "ThreadOpenAlert"
		UNION SELECT "guildId" AS guild_id FROM "Snippet"
	`;

	return rows.map((row) => row.guildId);
}

/**
 * Everything that must hold before a single row is written. Anything returned in `errors` aborts the
 * run outright; `warnings` are printed and proceed.
 */
async function preflight(
	legacy: Database,
	target: Executor,
	source: string,
): Promise<{ errors: string[]; warnings: string[] }> {
	const errors: string[] = [];
	const warnings: string[] = [];

	// This script is NOT idempotent for thread history, and running it twice is a plausible operator
	// slip mid-cutover. `guild_settings`/`snippets`/`blocks`/`thread_open_alerts` all self-skip on their
	// unique keys, but `threads` has no unique constraint (deliberately -- see migrateThreads), so a
	// second run would silently duplicate every ticket and every message in it. Refuse instead, using
	// the same "this row was migrated" predicate `--verify` uses.
	//
	// Scoped to `--source` rather than global, which is the entire reason that flag exists: rows left
	// behind by a *different* legacy deployment must not read as "already migrated" here, or the first
	// partner rehearsal would permanently block the public cutover — and the remedy printed below
	// would delete that partner's freshly migrated history. A second run of the same source is still
	// refused, which is the case this guard was actually written for.
	const [alreadyMigrated] = await target<[{ count: string }]>`
		SELECT COUNT(*) FROM threads WHERE migration_source = ${source}
	`;

	if (Number(alreadyMigrated!.count) > 0) {
		errors.push(
			`the target already holds ${alreadyMigrated!.count} thread(s) migrated from source '${source}' — this looks ` +
				`like a re-run, and thread history is not idempotent (a second pass duplicates every ticket). If you ` +
				`genuinely mean to start over, delete them first (messages, reply alerts and scheduled closes cascade):\n` +
				`        DELETE FROM threads WHERE migration_source = '${source}';`,
		);
	}

	// The cutover freezes new threads for 48h and then force-closes everything still open before this
	// script ever runs (see scripts/announce-modmail-migration.mjs). An open row migrated anyway is the
	// one case that breaks live behaviour rather than just sitting there as history: it counts against
	// `max_concurrent_threads` (default 1, blocking that user from opening a new ticket), and `/reply`
	// throws outright on its NULL `user_channel_id`. So this refuses rather than papering over it.
	const stillOpen = await legacy<{ channelId: string; guildId: string; threadId: number }[]>`
		SELECT "threadId" AS thread_id, "guildId" AS guild_id, "channelId" AS channel_id
		FROM "Thread"
		WHERE "closedAt" IS NULL
		ORDER BY "threadId"
	`;

	if (stillOpen.length > 0) {
		const sample = stillOpen
			.slice(0, 10)
			.map((row) => `#${row.threadId} (guild ${row.guildId})`)
			.join(', ');
		errors.push(
			`${stillOpen.length} legacy thread(s) are still open. Force-close them on the legacy side first — ` +
				`that is a deliberate runbook step, not something this script should do silently. e.g. ${sample}` +
				(stillOpen.length > 10 ? ', ...' : ''),
		);
	}

	// The new schema has real FKs where the legacy one relied on Prisma-side cascades; an orphan would
	// be rejected mid-transaction anyway, so surface it up front with a name attached instead.
	const [orphans] = await legacy<
		[{ messages: string; replyAlerts: string; scheduledCloses: string; snippetUpdates: string }]
	>`
		SELECT
			(SELECT COUNT(*) FROM "ThreadMessage" m WHERE NOT EXISTS (SELECT 1 FROM "Thread" t WHERE t."threadId" = m."threadId")) AS messages,
			(SELECT COUNT(*) FROM "ThreadReplyAlert" a WHERE NOT EXISTS (SELECT 1 FROM "Thread" t WHERE t."threadId" = a."threadId")) AS reply_alerts,
			(SELECT COUNT(*) FROM "ScheduledThreadClose" c WHERE NOT EXISTS (SELECT 1 FROM "Thread" t WHERE t."threadId" = c."threadId")) AS scheduled_closes,
			(SELECT COUNT(*) FROM "SnippetUpdates" u WHERE NOT EXISTS (SELECT 1 FROM "Snippet" s WHERE s."snippetId" = u."snippetId")) AS snippet_updates
	`;

	for (const [label, count] of Object.entries(orphans!)) {
		if (Number(count) > 0) {
			errors.push(`${count} orphaned ${label} row(s) in the legacy database with no surviving parent`);
		}
	}

	const guildIds = await collectLegacyGuildIds(legacy);

	// None of the three `= ANY(${guildIds})` lookups below need an "is the list empty" guard: postgres.js
	// infers the element type of an empty array fine, and `= ANY('{}')` is simply false for every row, so
	// an empty legacy database returns no rows and warns about nothing -- which is the correct answer, not
	// a degenerate case to special-case around.
	const existingSettings = await target<{ guildId: string }[]>`
		SELECT guild_id FROM guild_settings WHERE guild_id = ANY(${guildIds})
	`;
	if (existingSettings.length > 0) {
		warnings.push(
			`${existingSettings.length} legacy guild(s) already have a guild_settings row here and will be left ` +
				`untouched: ${existingSettings.map((row) => row.guildId).join(', ')}`,
		);
	}

	// Partner guilds onboarded onto custom instances are supposed to have had no prior history at
	// all. One showing up here means that assumption needs re-checking before anything is written.
	const instances = await target<{ guildId: string; id: string }[]>`
		SELECT id, guild_id FROM modmail_instances WHERE guild_id = ANY(${guildIds})
	`;
	if (instances.length > 0) {
		warnings.push(
			`${instances.length} legacy guild(s) are owned by a custom ModMail instance, which was not expected — ` +
				`re-check the "partner guilds have no legacy history" assumption: ` +
				instances.map((row) => `${row.guildId} (${row.id})`).join(', '),
		);
	}

	const collidingSnippets = await target<{ guildId: string; name: string }[]>`
		SELECT guild_id, name FROM snippets WHERE guild_id = ANY(${guildIds})
	`;
	if (collidingSnippets.length > 0) {
		warnings.push(
			`${collidingSnippets.length} snippet(s) already exist here for legacy guilds; any same-named legacy ` +
				`snippet will be skipped: ${collidingSnippets.map((row) => `${row.guildId}/${row.name}`).join(', ')}`,
		);
	}

	return { errors, warnings };
}

/**
 * The guilds whose admins have to go pick a forum on the dashboard before ModMail works for them
 * again -- i.e. everyone who had a configured legacy channel, since `mod_forum_id` is deliberately
 * migrated as NULL. Printed so the list can drive follow-up comms rather than being discovered by
 * users filing bug reports.
 */
async function guildsNeedingAForum(legacy: Database): Promise<string[]> {
	const rows = await legacy<{ guildId: string }[]>`
		SELECT "guildId" AS guild_id
		FROM "GuildSettings"
		WHERE "modmailChannelId" IS NOT NULL
		ORDER BY "guildId"
	`;

	return rows.map((row) => row.guildId);
}

async function runMigration(legacy: Database, tx: Executor, source: string): Promise<Stats> {
	const stats: Stats = {};

	stats['guild_settings'] = await migrateGuildSettings(legacy, tx);

	const [snippetStat, snippetIds] = await migrateSnippets(legacy, tx);
	stats['snippets'] = snippetStat;
	stats['snippet_updates'] = await migrateSnippetUpdates(legacy, tx, snippetIds);

	stats['blocks'] = await migrateBlocks(legacy, tx);
	stats['thread_open_alerts'] = await migrateThreadOpenAlerts(legacy, tx);

	const [threadStat, threadIds] = await migrateThreads(legacy, tx, source);
	stats['threads'] = threadStat;
	stats['thread_messages'] = await migrateThreadMessages(legacy, tx, threadIds);
	stats['thread_reply_alerts'] = await migrateThreadReplyAlerts(legacy, tx, threadIds);
	stats['scheduled_thread_closes'] = await migrateScheduledThreadCloses(legacy, tx, threadIds);

	return stats;
}

/**
 * `snippet_updates` reconciled against only the snippets that actually landed.
 *
 * A legacy snippet whose `(guildId, name)` already existed in the target is skipped, and its updates
 * go with it -- comparing raw totals would then report a shortfall that is correct behaviour, which is
 * exactly the kind of false alarm that teaches an operator to ignore this output. Migrated snippets
 * are told apart from pre-existing ones by `created_at`: it is carried over verbatim, so a
 * `(guild_id, name, created_at)` triple matching on both sides is a snippet this migration wrote.
 */
async function verifySnippetUpdates(
	legacy: Database,
	target: Executor,
	guildIds: string[],
	report: (label: string, left: number, right: number) => void,
): Promise<void> {
	const legacySnippets = await legacy<{ createdAt: Date; guildId: string; name: string; snippetId: number }[]>`
		SELECT "snippetId" AS snippet_id, "guildId" AS guild_id, "name" AS name, "createdAt" AS created_at
		FROM "Snippet"
	`;

	const targetSnippets = await target<{ createdAt: Date; guildId: string; id: number; name: string }[]>`
		SELECT id, guild_id, name, created_at FROM snippets WHERE guild_id = ANY(${guildIds})
	`;

	// `JSON.stringify` rather than joining on a delimiter: it can't be made ambiguous by a delimiter
	// character turning up inside a snippet name, and unlike the NUL byte this used to use, it doesn't
	// make the whole source file read as binary to `grep`/`file`.
	const key = (guildId: string, name: string, createdAt: Date): string =>
		JSON.stringify([guildId, name, createdAt.getTime()]);
	const targetByKey = new Map(targetSnippets.map((row) => [key(row.guildId, row.name, row.createdAt), row.id]));

	const migratedLegacyIds: number[] = [];
	const migratedTargetIds: number[] = [];
	const notMigrated: string[] = [];

	for (const snippet of legacySnippets) {
		const targetId = targetByKey.get(key(snippet.guildId, snippet.name, snippet.createdAt));
		if (targetId === undefined) {
			notMigrated.push(`${snippet.guildId}/${snippet.name}`);
		} else {
			migratedLegacyIds.push(snippet.snippetId);
			migratedTargetIds.push(targetId);
		}
	}

	const [legacyCount] = await legacy<[{ count: string }]>`
		SELECT COUNT(*) FROM "SnippetUpdates" WHERE "snippetId" = ANY(${migratedLegacyIds})
	`;
	const [targetCount] = await target<[{ count: string }]>`
		SELECT COUNT(*) FROM snippet_updates WHERE snippet_id = ANY(${migratedTargetIds})
	`;

	report('snippet_updates', Number(legacyCount!.count), Number(targetCount!.count));

	if (notMigrated.length > 0) {
		console.log(
			`       (${notMigrated.length} legacy snippet(s) were skipped because a same-named one already existed here, ` +
				`so their updates are excluded from the comparison above: ${notMigrated.join(', ')})`,
		);
	}
}

/**
 * Read-only reconciliation across both databases (#158's tooling).
 *
 * Migrated threads are identified by `migration_source = ${source}`, so this reconciles the legacy
 * database currently connected against only the rows *that* run produced -- rows migrated from some
 * other legacy deployment are invisible here rather than counted against a legacy database they never
 * came from. This does assume the target has not accepted new ModMail writes for these guilds since
 * the migration ran, which is exactly the situation during a cutover.
 */
async function runVerify(legacy: Database, target: Executor, source: string): Promise<boolean> {
	let ok = true;

	const report = (label: string, left: number, right: number): void => {
		const matched = left === right;
		ok &&= matched;
		console.log(`  ${matched ? 'OK  ' : 'FAIL'} ${label.padEnd(24)} legacy=${left} target=${right}`);
	};

	// Must be the same set `preflight` uses, and must cover every guild-carrying legacy table -- see
	// `collectLegacyGuildIds`. The legacy-side counts below are unfiltered `COUNT(*)`, so any guild
	// missing from this list would be counted on one side and filtered out on the other.
	const guildIds = await collectLegacyGuildIds(legacy);

	console.log('\nRow counts');

	// Note which tables are *self-cancelling* under an ON CONFLICT DO NOTHING skip and which are not.
	// `guild_settings`/`snippets`/`blocks`/`thread_open_alerts` skip a legacy row precisely because a
	// target row with the same key already exists, so the guild-scoped target count still matches the
	// legacy one -- a skip is invisible here, correctly. `snippet_updates` is the one exception: the
	// updates belonging to a skipped snippet have no counterpart at all, so it is reconciled separately
	// below against only those snippets that actually landed.
	const [legacyCounts] = await legacy<[Record<string, string>]>`
		SELECT
			(SELECT COUNT(*) FROM "GuildSettings")        AS guild_settings,
			(SELECT COUNT(*) FROM "Snippet")              AS snippets,
			(SELECT COUNT(*) FROM "Block")                AS blocks,
			(SELECT COUNT(*) FROM "ThreadOpenAlert")      AS thread_open_alerts,
			(SELECT COUNT(*) FROM "Thread")               AS threads,
			(SELECT COUNT(*) FROM "ThreadMessage")        AS thread_messages,
			(SELECT COUNT(*) FROM "ThreadReplyAlert")     AS thread_reply_alerts,
			(SELECT COUNT(*) FROM "ScheduledThreadClose") AS scheduled_thread_closes
	`;

	const [targetCounts] = await target<[Record<string, string>]>`
		SELECT
			(SELECT COUNT(*) FROM guild_settings WHERE guild_id = ANY(${guildIds}))    AS guild_settings,
			(SELECT COUNT(*) FROM snippets WHERE guild_id = ANY(${guildIds}))          AS snippets,
			(SELECT COUNT(*) FROM blocks WHERE guild_id = ANY(${guildIds}))            AS blocks,
			(SELECT COUNT(*) FROM thread_open_alerts WHERE guild_id = ANY(${guildIds})) AS thread_open_alerts,
			(SELECT COUNT(*) FROM threads WHERE migration_source = ${source}) AS threads,
			(SELECT COUNT(*) FROM thread_messages m JOIN threads t ON t.id = m.thread_id WHERE t.migration_source = ${source}) AS thread_messages,
			(SELECT COUNT(*) FROM thread_reply_alerts a JOIN threads t ON t.id = a.thread_id WHERE t.migration_source = ${source}) AS thread_reply_alerts,
			(SELECT COUNT(*) FROM scheduled_thread_closes c JOIN threads t ON t.id = c.thread_id WHERE t.migration_source = ${source}) AS scheduled_thread_closes
	`;

	for (const [table, count] of Object.entries(legacyCounts!)) {
		// The `postgres.camel` transform turns the snake_case aliases above back into camelCase keys;
		// undo that for display so these read as the table names they actually are.
		const label = table.replaceAll(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
		report(label, Number(count), Number(targetCounts![table] ?? 0));
	}

	await verifySnippetUpdates(legacy, target, guildIds, report);

	console.log('\nPer-thread message counts');

	// Threads are matched across the two databases by `mod_thread_id` (legacy `channelId`) -- a real
	// Discord channel id, and the only natural key both sides share once the integer PKs are
	// regenerated.
	const legacyPerThread = new Map(
		(
			await legacy<{ channelId: string; messages: string }[]>`
				SELECT t."channelId" AS channel_id, COUNT(m."threadMessageId") AS messages
				FROM "Thread" t
				LEFT JOIN "ThreadMessage" m ON m."threadId" = t."threadId"
				GROUP BY t."channelId"
			`
		).map((row) => [row.channelId, Number(row.messages)]),
	);

	const targetPerThread = new Map(
		(
			await target<{ messages: string; modThreadId: string }[]>`
				SELECT t.mod_thread_id, COUNT(m.id) AS messages
				FROM threads t
				LEFT JOIN thread_messages m ON m.thread_id = t.id
				WHERE t.migration_source = ${source}
				GROUP BY t.mod_thread_id
			`
		).map((row) => [row.modThreadId, Number(row.messages)]),
	);

	const mismatched: string[] = [];
	for (const [modThreadId, expected] of legacyPerThread) {
		const actual = targetPerThread.get(modThreadId);
		if (actual !== expected) {
			mismatched.push(`${modThreadId} (legacy=${expected} target=${actual ?? 'missing'})`);
		}
	}

	// Walking only the legacy side never surfaces a thread that exists here but not there. Strictly, some
	// other check always trips too -- an unpaired extra shows up in the row counts, and a paired one means
	// its partner (a legacy thread that failed to migrate) is caught by the loop above -- so this isn't
	// detecting anything otherwise invisible. What it buys is a *complete* diagnosis in one pass, instead
	// of fixing the half that got reported and re-running to discover the other half. An extra on this
	// side means either a partially-cleaned-up re-run, or `--source` naming a different legacy deployment
	// than `LEGACY_DATABASE_URL` points at.
	for (const [modThreadId, actual] of targetPerThread) {
		if (!legacyPerThread.has(modThreadId)) {
			mismatched.push(`${modThreadId} (legacy=missing target=${actual})`);
		}
	}

	if (mismatched.length > 0) {
		ok = false;
		console.log(`  FAIL ${mismatched.length} thread(s) disagree: ${mismatched.slice(0, 10).join(', ')}`);
	} else {
		console.log(`  OK   all ${legacyPerThread.size} thread(s) have matching message counts`);
	}

	console.log(`\nMessage-set spot check (${VERIFY_SAMPLE_SIZE} random threads)`);

	const sample = await legacy<{ channelId: string; threadId: number }[]>`
		SELECT "threadId" AS thread_id, "channelId" AS channel_id
		FROM "Thread"
		ORDER BY random()
		LIMIT ${VERIFY_SAMPLE_SIZE}
	`;

	let sampleFailures = 0;
	for (const thread of sample) {
		const legacyMessages = await legacy<{ guildMessageId: string; localThreadMessageId: number }[]>`
			SELECT "localThreadMessageId" AS local_thread_message_id, "guildMessageId" AS guild_message_id
			FROM "ThreadMessage"
			WHERE "threadId" = ${thread.threadId}
			ORDER BY "localThreadMessageId"
		`;

		const targetMessages = await target<{ guildMessageId: string; localThreadMessageId: number }[]>`
			SELECT m.local_thread_message_id, m.guild_message_id
			FROM thread_messages m
			JOIN threads t ON t.id = m.thread_id
			WHERE t.mod_thread_id = ${thread.channelId} AND t.migration_source = ${source}
			ORDER BY m.local_thread_message_id
		`;

		const left = legacyMessages.map((row) => `${row.localThreadMessageId}:${row.guildMessageId}`).join('|');
		const right = targetMessages.map((row) => `${row.localThreadMessageId}:${row.guildMessageId}`).join('|');

		if (left !== right) {
			sampleFailures += 1;
			console.log(`  FAIL legacy thread #${thread.threadId} (mod thread ${thread.channelId}) message set differs`);
		}
	}

	if (sampleFailures === 0) {
		console.log(`  OK   all ${sample.length} sampled thread(s) match exactly`);
	} else {
		ok = false;
	}

	return ok;
}

function printStats(stats: Stats): void {
	console.log('\nTable                     read  inserted  skipped');
	for (const [table, stat] of Object.entries(stats)) {
		console.log(
			`  ${table.padEnd(24)}${String(stat.read).padStart(4)}${String(stat.inserted).padStart(10)}${String(stat.skipped).padStart(9)}`,
		);
	}
}

// `--source` values land in `threads.migration_source` and are interpolated into the `DELETE`
// statement `preflight` prints for an operator to paste, so they are kept to an unambiguous slug
// rather than accepting arbitrary text. Deliberately the same shape as `modmail_instances.id`, since
// a partner migration and that partner's instance slug naturally want to be the same string.
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
			`Pass --source <slug> naming the legacy deployment being migrated (e.g. --source nascar). Must match ` +
				`${SOURCE_PATTERN.source}. It is recorded on every migrated thread, and is what keeps one legacy ` +
				`deployment's migration from blocking or miscounting another's.`,
		);
		process.exit(1);
	}

	return { mode: flags[0]!.slice(2) as Mode, source };
}

// Destructured rather than accessed key-by-key: `ProcessEnv` is an index signature, so
// `noPropertyAccessFromIndexSignature` rejects dot access while eslint's `dot-notation` rejects
// bracket access. Destructuring is the one form both are happy with.
const { IS_PRODUCTION, DATABASE_URL_DEV, DATABASE_URL_PROD, LEGACY_DATABASE_URL } = process.env;

// The exact sets `zod`'s `stringbool()` uses, which is what parses IS_PRODUCTION in
// `@chatsift/backend-core`'s shared env schema. Duplicated rather than imported because this script
// deliberately doesn't pull in backend-core (see the file header) -- but it has to agree with it
// *exactly*: this script picking a different database than every other service in the stack, while
// `--live` commits real inserts, is the single worst way for it to be wrong.
const TRUTHY = new Set(['true', '1', 'yes', 'on', 'y', 'enabled']);
const FALSY = new Set(['false', '0', 'no', 'off', 'n', 'disabled']);

function resolveTargetUrl(): string {
	// `envSchema` declares IS_PRODUCTION as `.default(false)`, so unset means dev -- but an unrecognized
	// value is an error there, not a silent falsy. Match that: quietly treating `IS_PRODUCTION=maybe` as
	// dev would point a `--live` run at DATABASE_URL_DEV while the rest of the stack ran on prod config.
	const raw = (IS_PRODUCTION ?? 'false').toLowerCase();
	if (!TRUTHY.has(raw) && !FALSY.has(raw)) {
		console.error(
			`IS_PRODUCTION is set to ${JSON.stringify(IS_PRODUCTION)}, which is not a recognized boolean — ` +
				`expected one of ${[...TRUTHY, ...FALSY].join(', ')}. Refusing to guess which database to target.`,
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

const { mode, source } = resolveArgs();

const legacyUrl = LEGACY_DATABASE_URL;
if (!legacyUrl) {
	console.error('LEGACY_DATABASE_URL is required — point it at a restored copy of the ChatSift/ModMail database');
	process.exit(1);
}

const legacy = createDb({ url: legacyUrl });
const target = createDb({ url: resolveTargetUrl() });

let exitCode = 0;

try {
	if (mode === 'verify') {
		console.log(`Mode: verify (read-only), source: ${source}`);
		exitCode = (await runVerify(legacy, target, source)) ? 0 : 1;
	} else {
		console.log(`Mode: ${mode}${mode === 'dry-run' ? ' (everything below is rolled back)' : ''}, source: ${source}`);

		const { errors, warnings } = await preflight(legacy, target, source);

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
		try {
			await target.begin(async (tx) => {
				// The whole migration is one transaction, and it interleaves reads against the *legacy*
				// database between writes here -- so this connection sits idle for stretches that have
				// nothing to do with how fast Postgres is. A server-side `statement_timeout` or
				// `idle_in_transaction_session_timeout` (neither is set on the local compose Postgres, but
				// production is configured elsewhere) would kill the transaction partway through and force
				// the whole run to be restarted. `SET LOCAL` scopes both to this transaction, so they revert
				// on commit or rollback rather than leaking into the pooled connection.
				await tx`SET LOCAL statement_timeout = 0`;
				await tx`SET LOCAL idle_in_transaction_session_timeout = 0`;

				stats = await runMigration(legacy, tx, source);

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

		const needsForum = await guildsNeedingAForum(legacy);
		console.log(
			`\n${needsForum.length} guild(s) had a configured legacy ModMail channel and now have mod_forum_id = NULL.` +
				'\nTheir admins must pick a real Forum channel on the dashboard before ModMail works for them again:',
		);
		console.log(needsForum.length > 0 ? `  ${needsForum.join(', ')}` : '  (none)');

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
