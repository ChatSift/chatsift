import { getContext, publishRealtimeInvalidate } from '@chatsift/backend-core';
import { automoderatorReportsChannel } from '@chatsift/core';
import type {
	AutomoderatorGuildSettings,
	AutomoderatorReporters,
	AutomoderatorReports,
	AutomoderatorReportsId,
	AutomoderatorReportState,
} from '@chatsift/db';
import { isUniqueViolation } from '@chatsift/db';
import type { CaseActor } from './cases.js';
import { reportsTotal } from './metrics.js';

/**
 * Runtime values for `automoderator_report_state`, which kanel generates as a TypeScript enum that
 * `@chatsift/db` only re-exports the *type* of -- so there is nothing to compare against without this. Same
 * arrangement as `caseActions.ts`.
 */
export const REPORT_STATE = {
	OPEN: 'OPEN' as AutomoderatorReportState,
	DISMISSED: 'DISMISSED' as AutomoderatorReportState,
	ACTIONED: 'ACTIONED' as AutomoderatorReportState,
} as const satisfies Record<string, AutomoderatorReportState>;

/**
 * Why a report was refused. Kept as a closed set rather than bare strings so the two context menus and (later)
 * the filter hook all phrase the same refusal the same way.
 */
export type ReportRefusal = 'already-reported' | 'already-reviewed' | 'reporting-disabled' | 'self';

/**
 * The refusal wording lives with the type rather than at each call site, so the two context menus -- and the
 * filter hook feature 30 adds at P5 -- cannot phrase the same refusal three different ways.
 */
export const REFUSAL_MESSAGES: Record<ReportRefusal, string> = {
	'already-reported': 'You have already reported this.',
	'already-reviewed': 'A moderator has already reviewed this message.',
	'reporting-disabled': 'This server is not accepting reports.',
	self: 'You cannot report yourself.',
};

export class ReportFailure extends Error {
	public constructor(public readonly refusal: ReportRefusal) {
		super(REFUSAL_MESSAGES[refusal]);
		this.name = 'ReportFailure';
	}
}

/**
 * The snapshot half of a report. Taken from the interaction's `resolved.messages` payload rather than fetched:
 * a report exists precisely because the message might not survive until a moderator looks at it, and this bot
 * has no message cache until P4.
 */
export interface ReportedMessage {
	readonly channelId: string;
	readonly content: string | null;
	readonly imageUrl: string | null;
	readonly messageId: string;
}

export interface FileReportOptions {
	readonly guildId: string;
	/**
	 * `null` files an account-level report. Nothing does at P3 -- see schema.sql.
	 */
	readonly message: ReportedMessage | null;
	readonly reason: string;
	readonly reporter: CaseActor;
	readonly target: CaseActor;
}

export interface FileReportResult {
	/**
	 * True when this reporter joined a report that already existed, rather than opening a new one. The caller
	 * uses it to decide between posting a card and refreshing the one already there.
	 */
	readonly joined: boolean;
	readonly report: AutomoderatorReports;
	readonly reporterCount: number;
}

export async function getReportsChannelId(guildId: string): Promise<string | null> {
	const [row] = await getContext().db<Pick<AutomoderatorGuildSettings, 'reportsChannelId'>[]>`
		SELECT reports_channel_id FROM automoderator_guild_settings WHERE guild_id = ${guildId}
	`;

	return row?.reportsChannelId ?? null;
}

export async function getReport(id: AutomoderatorReportsId | number): Promise<AutomoderatorReports | null> {
	const [row] = await getContext().db<AutomoderatorReports[]>`
		SELECT * FROM automoderator_reports WHERE id = ${id}
	`;

	return row ?? null;
}

export async function listReporters(id: AutomoderatorReportsId | number): Promise<AutomoderatorReporters[]> {
	return getContext().db<AutomoderatorReporters[]>`
		SELECT * FROM automoderator_reporters WHERE report_id = ${id} ORDER BY created_at ASC
	`;
}

export async function countReporters(id: AutomoderatorReportsId | number): Promise<number> {
	const [row] = await getContext().db<{ count: string }[]>`
		SELECT count(*) FROM automoderator_reporters WHERE report_id = ${id}
	`;

	return Number(row?.count ?? 0);
}

async function findExisting(options: FileReportOptions): Promise<AutomoderatorReports | null> {
	const db = getContext().db;

	// Message reports look across every state, account-level ones only across open reports -- see the two
	// partial unique indexes in schema.sql for why those differ.
	const [row] = options.message
		? await db<AutomoderatorReports[]>`
				SELECT * FROM automoderator_reports
				WHERE guild_id = ${options.guildId} AND message_id = ${options.message.messageId}
			`
		: await db<AutomoderatorReports[]>`
				SELECT * FROM automoderator_reports
				WHERE guild_id = ${options.guildId}
					AND target_id = ${options.target.id}
					AND message_id IS NULL
					AND state = 'OPEN'
			`;

	return row ?? null;
}

async function addReporter(report: AutomoderatorReports, options: FileReportOptions): Promise<FileReportResult> {
	if (report.state !== REPORT_STATE.OPEN) {
		throw new ReportFailure('already-reviewed');
	}

	try {
		await getContext().db`
			INSERT INTO automoderator_reporters (report_id, reporter_id, reporter_tag, reason)
			VALUES (${report.id}, ${options.reporter.id}, ${options.reporter.tag}, ${options.reason})
		`;
	} catch (error) {
		// The primary key is the "you already reported this" check -- insert-and-catch rather than
		// read-then-insert, so two rapid clicks resolve to one row instead of both passing a prior check.
		if (isUniqueViolation(error, 'automoderator_reporters_pkey')) {
			throw new ReportFailure('already-reported');
		}

		throw error;
	}

	reportsTotal.inc({ state: 'joined' });
	await publishRealtimeInvalidate(automoderatorReportsChannel(report.guildId));

	return { report, joined: true, reporterCount: await countReporters(report.id) };
}

/**
 * Opens a report, or attaches this reporter to the one that already covers it.
 *
 * Deliberately does **not** post the card -- `syncReportCard` in `reportCard.ts` does, and the split is what
 * lets the filter hook feature 30 adds at P5 file a report without owning the card lifecycle. The card is a
 * Discord side effect and this is a database write, which is the same seam `createCase`/`dispatchCaseLog` keep.
 */
export async function fileReport(options: FileReportOptions): Promise<FileReportResult> {
	if (options.reporter.id === options.target.id) {
		throw new ReportFailure('self');
	}

	const existing = await findExisting(options);
	if (existing) {
		return addReporter(existing, options);
	}

	const db = getContext().db;

	const row = {
		guildId: options.guildId,
		targetId: options.target.id,
		targetTag: options.target.tag,
		messageId: options.message?.messageId ?? null,
		channelId: options.message?.channelId ?? null,
		messageContent: options.message?.content ?? null,
		messageImageUrl: options.message?.imageUrl ?? null,
	};

	let created: AutomoderatorReports | undefined;

	try {
		[created] = await db<AutomoderatorReports[]>`
			INSERT INTO automoderator_reports ${db(row)} RETURNING *
		`;
	} catch (error) {
		// Two people reporting the same message within the same tick both find nothing above and both insert.
		// The unique index rejects the loser, who is then in exactly the "join the existing report" case -- so
		// re-read and fall through rather than surfacing a database error to a member.
		if (
			isUniqueViolation(error, 'automoderator_reports_guild_id_message_id_idx') ||
			isUniqueViolation(error, 'automoderator_reports_guild_id_target_id_open_idx')
		) {
			const raced = await findExisting(options);
			if (raced) {
				return addReporter(raced, options);
			}
		}

		throw error;
	}

	const inserted = created!;

	await db`
		INSERT INTO automoderator_reporters (report_id, reporter_id, reporter_tag, reason)
		VALUES (${inserted.id}, ${options.reporter.id}, ${options.reporter.tag}, ${options.reason})
	`;

	reportsTotal.inc({ state: 'filed' });
	await publishRealtimeInvalidate(automoderatorReportsChannel(inserted.guildId));

	return { report: inserted, joined: false, reporterCount: 1 };
}

export interface ResolveReportOptions {
	/**
	 * The case this resolution produced, for an ACTIONED report. Absent leaves the column alone rather than
	 * nulling it -- a partial patch, the same shape `updateCase` takes.
	 */
	readonly caseId?: number;
	/**
	 * The state the caller believes the row is still in. **Every caller should pass this**: a card can sit on
	 * screen for as long as someone leaves it there, and a modal for up to five minutes, so the state a handler
	 * read is a claim about the past by the time it writes.
	 */
	readonly expected?: AutomoderatorReportState;
	readonly moderator: CaseActor | null;
	readonly state: AutomoderatorReportState;
}

/**
 * Moves a report to a new state, compare-and-swap. Returns `null` when `expected` no longer holds, which callers
 * must read as "somebody got there first" rather than as an error.
 *
 * The `expected` predicate is in the `WHERE` clause rather than checked beforehand on purpose: a check narrows
 * the window, only a conditional write closes it. Without it, two moderators handling one card race to overwrite
 * each other -- and in the action path that means two punishments for one report, with the second one's
 * `case_id` erasing the first.
 *
 * `resolved_by`/`resolved_at` are cleared when going back to OPEN, so a restored report doesn't keep claiming it
 * was resolved by whoever restored it.
 *
 * Deliberately does **not** touch `reportsTotal`. The action path claims the report *before* it punishes anybody
 * (so the claim is the mutex) and rolls back if the punishment fails, so a write here is not yet evidence that
 * anything happened -- counting it from inside would produce exactly the "actions we claim but didn't take"
 * dishonesty `actionExecutor.ts` avoids. Callers count once they know.
 */
export async function setReportState(
	id: AutomoderatorReportsId | number,
	options: ResolveReportOptions,
): Promise<AutomoderatorReports | null> {
	const isOpen = options.state === REPORT_STATE.OPEN;
	const db = getContext().db;

	const columns: Record<string, Date | number | string | null> = {
		state: options.state,
		resolvedBy: isOpen ? null : (options.moderator?.id ?? null),
		resolvedAt: isOpen ? null : new Date(),
		...(options.caseId === undefined ? {} : { caseId: options.caseId }),
	};

	const [updated] = await db<AutomoderatorReports[]>`
		UPDATE automoderator_reports SET ${db(columns)}
		WHERE id = ${id}
		${options.expected === undefined ? db`` : db`AND state = ${options.expected}`}
		RETURNING *
	`;

	if (!updated) {
		return null;
	}

	await publishRealtimeInvalidate(automoderatorReportsChannel(updated.guildId));

	return updated;
}

/**
 * Records the case an actioned report produced, once the punishment has actually landed. Split from the state
 * transition because the two happen at different moments -- see `setReportState`'s note on claiming first.
 */
export async function recordReportCase(
	id: AutomoderatorReportsId | number,
	caseId: number,
): Promise<AutomoderatorReports | null> {
	const [updated] = await getContext().db<AutomoderatorReports[]>`
		UPDATE automoderator_reports SET case_id = ${caseId} WHERE id = ${id} RETURNING *
	`;

	if (!updated) {
		return null;
	}

	await publishRealtimeInvalidate(automoderatorReportsChannel(updated.guildId));

	return updated;
}

export async function setReportCard(
	id: AutomoderatorReportsId | number,
	card: { channelId: string; messageId: string } | null,
): Promise<void> {
	await getContext().db`
		UPDATE automoderator_reports
		SET card_channel_id = ${card?.channelId ?? null}, card_message_id = ${card?.messageId ?? null}
		WHERE id = ${id}
	`;
}
