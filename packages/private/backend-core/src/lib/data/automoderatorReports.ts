import type { ReportEmbedInput, ReportOriginName, ReportStateName } from '@chatsift/core';
import { automoderatorReportsChannel } from '@chatsift/core';
import type {
	AutomoderatorGuildSettings,
	AutomoderatorReporters,
	AutomoderatorReportMessages,
	AutomoderatorReports,
	AutomoderatorReportsId,
	AutomoderatorReportState,
} from '@chatsift/db';
import { isUniqueViolation } from '@chatsift/db';
import { getContext } from '../context.js';
import { publishRealtimeInvalidate } from '../realtimeBroadcast.js';

/**
 * The report spine, shared by `services/automoderator-bot` (the two guild context menus, P3) and
 * `services/api` (the DM report a reporter confirms on the website, P3b). Two writers of the same tables means
 * the dedupe lookup, the two unique-index races and the state compare-and-swap have to live somewhere neither
 * owns -- the same reasoning that put the mod-log embed in `@chatsift/core`.
 *
 * Deliberately owns **no Discord side effect**: posting or rewriting the card is `reportCard.ts`'s job in the
 * bot and `reportCard.ts`'s job in the API, exactly as `createCase` and `dispatchCaseLog` are split. It also
 * touches no Prometheus counter -- `reportsTotal` lives in the bot's registry, and the bot increments it from
 * the `joined` flag this returns.
 */

/**
 * Runtime values for `automoderator_report_state`, which kanel generates as a TypeScript enum that
 * `@chatsift/db` only re-exports the *type* of -- so there is nothing to compare against without this. Same
 * arrangement as the bot's `caseActions.ts`.
 */
export const REPORT_STATE = {
	OPEN: 'OPEN' as AutomoderatorReportState,
	DISMISSED: 'DISMISSED' as AutomoderatorReportState,
	ACTIONED: 'ACTIONED' as AutomoderatorReportState,
} as const satisfies Record<string, AutomoderatorReportState>;

/**
 * Structurally identical to the bot's `CaseActor`, redeclared rather than imported: a service cannot be a
 * dependency of a package.
 */
export interface ReportActor {
	readonly id: string;
	readonly tag: string;
}

/**
 * Why a report was refused. Kept as a closed set rather than bare strings so the two context menus, the DM
 * submission route and (later) the filter hook all phrase the same refusal the same way.
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
 * The subject message -- the one that dedupes and the one the card leads with. Taken from the interaction's
 * `resolved.messages` payload rather than fetched: a report exists precisely because the message might not
 * survive until a moderator looks at it, and this bot has no message cache until P4.
 */
export interface ReportedMessage {
	readonly channelId: string;
	readonly content: string | null;
	readonly imageUrl: string | null;
	readonly messageId: string;
}

/**
 * One of the *additional* messages a DM draft carried (P3b) -- see `automoderator_report_messages`. Carries its
 * own author because a draft can legitimately include the reporter's own replies, which the subject message
 * never needs (there the author is the target).
 */
export interface ReportContextMessage extends ReportedMessage {
	readonly author: ReportActor;
}

export interface FileReportOptions {
	/**
	 * Additional messages, in the order the reporter chose. Empty for every guild report; only a DM draft
	 * fills it. Ignored entirely when this call joins an existing report rather than opening one -- see
	 * `addReporter`.
	 */
	readonly contextMessages?: readonly ReportContextMessage[];
	readonly guildId: string;
	/**
	 * `null` files an account-level report -- see schema.sql.
	 */
	readonly message: ReportedMessage | null;
	/**
	 * Where the reported message was, which is a different question from where the report went. Decides
	 * whether the card renders a jump link. Defaults to `GUILD`.
	 */
	readonly origin?: 'DM' | 'GUILD';
	readonly reason: string;
	readonly reporter: ReportActor;
	readonly target: ReportActor;
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

/**
 * The extra messages a DM report carried, in the reporter's chosen order. Empty for a guild report, which is
 * why every card and view calls this unconditionally rather than branching on `origin` first.
 */
export async function listReportMessages(id: AutomoderatorReportsId | number): Promise<AutomoderatorReportMessages[]> {
	return getContext().db<AutomoderatorReportMessages[]>`
		SELECT * FROM automoderator_report_messages WHERE report_id = ${id} ORDER BY position ASC
	`;
}

/**
 * The account that opened the report -- the oldest reporter, since later ones are agreeing with it rather than
 * filing it. The card needs it to label the context messages the reporter wrote themselves, and only a DM
 * report has any, so callers look it up only when there are.
 */
export async function getOriginatingReporterId(id: AutomoderatorReportsId | number): Promise<string | null> {
	const [row] = await getContext().db<Pick<AutomoderatorReporters, 'reporterId'>[]>`
		SELECT reporter_id FROM automoderator_reporters
		WHERE report_id = ${id}
		ORDER BY created_at ASC
		LIMIT 1
	`;

	return row?.reporterId ?? null;
}

/**
 * Narrows a row to the structural shape `@chatsift/core`'s card builders take.
 *
 * The two enum columns come back as kanel enum types that `@chatsift/db` only re-exports the *type* of, hence
 * the casts -- the same arrangement `caseFormat.ts` needs for `actionType`. Here rather than at each card
 * poster because both `services/api` and `services/automoderator-bot` post cards, and two copies of a cast is
 * two places for the conversion to drift.
 */
export function reportEmbedInput(report: AutomoderatorReports): ReportEmbedInput {
	return {
		...report,
		origin: report.origin as unknown as ReportOriginName,
		state: report.state as unknown as ReportStateName,
	};
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

/**
 * Attaches a reporter to a report that already exists.
 *
 * `contextMessages` is deliberately dropped here. The messages already on the report are the ones staff have
 * been reading, and letting the second reporter append to them would rewrite the evidence under a card that
 * may already have been acted on -- and, worse, let anyone who can guess a reported DM message id splice their
 * own text into somebody else's report.
 */
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

	await publishRealtimeInvalidate(automoderatorReportsChannel(report.guildId));

	return { report, joined: true, reporterCount: await countReporters(report.id) };
}

/**
 * Opens a report, or attaches this reporter to the one that already covers it.
 *
 * Deliberately does **not** post the card -- that is the caller's, and the split is what lets the API file a
 * DM report and the filter hook feature 30 adds at P5 file one without either owning the card lifecycle. The
 * card is a Discord side effect and this is a database write, which is the same seam
 * `createCase`/`dispatchCaseLog` keep.
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
		origin: options.origin ?? 'GUILD',
		messageId: options.message?.messageId ?? null,
		channelId: options.message?.channelId ?? null,
		messageContent: options.message?.content ?? null,
		messageImageUrl: options.message?.imageUrl ?? null,
	};

	const contextMessages = options.contextMessages ?? [];

	let created: AutomoderatorReports | undefined;

	try {
		// One transaction, because a report with no reporters is a queue item with no reason text on it -- the card
		// would claim one reporter (it is handed the count in memory) while the detail view showed none. The unique
		// violation below is still caught *outside*, which works because a failed transaction has rolled back.
		//
		// The context messages join that transaction for the same reason: a DM report that committed its subject
		// message but lost the conversation around it is worse than one that never landed, because staff would read
		// the baited half and have no way to tell anything was missing.
		created = await db.begin(async (tx) => {
			const [report] = await tx<AutomoderatorReports[]>`
				INSERT INTO automoderator_reports ${tx(row)} RETURNING *
			`;

			await tx`
				INSERT INTO automoderator_reporters (report_id, reporter_id, reporter_tag, reason)
				VALUES (${report!.id}, ${options.reporter.id}, ${options.reporter.tag}, ${options.reason})
			`;

			if (contextMessages.length) {
				await tx`
					INSERT INTO automoderator_report_messages ${tx(
						contextMessages.map((message, index) => ({
							reportId: report!.id,
							// 1-based: position 0 is the parent row's own snapshot.
							position: index + 1,
							messageId: message.messageId,
							channelId: message.channelId,
							authorId: message.author.id,
							authorTag: message.author.tag,
							content: message.content,
							imageUrl: message.imageUrl,
						})),
					)}
				`;
			}

			return report!;
		});
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
	readonly moderator: ReportActor | null;
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
