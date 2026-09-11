import type {
	APIActionRowComponent,
	APIButtonComponent,
	APIEmbed,
	APIMessageTopLevelComponent,
} from 'discord-api-types/v10';
import { ButtonStyle, ComponentType } from 'discord-api-types/v10';
import { APPEAL_ANSWER_MAX_LENGTH, APPEAL_QUESTION_PROMPT_MAX_LENGTH } from './constants.js';
import { fence, truncate } from './discordText.js';

/**
 * The appeal card (#232 P4, decision 13: **exactly one embed**, edited in place for the life of the appeal).
 * Shared by `services/api`, which posts it when an appeal is filed on `unban.app`, and
 * `services/appeals-bot`, which rewrites it on every decision. Two producers of the same message means the
 * builder lives somewhere neither owns, exactly like `automoderatorReportEmbeds.ts`.
 *
 * Takes structural shapes rather than `@chatsift/db`'s row types: this package is depended on by
 * `apps/website` and must not pull the database client in behind it.
 */

/**
 * Mirrors `CREATE TYPE appeal_status`. A string union rather than the generated enum, for the dependency
 * reason above -- call sites holding a row cast, the same way `ReportStateName` already needs.
 */
export type AppealStatusName = 'APPROVED' | 'DENIED' | 'MOOT' | 'PENDING' | 'WITHDRAWN';

/**
 * Custom-id prefixes for the card's buttons. Each is a separate registered `ComponentHandler` in
 * `services/appeals-bot`, rather than one handler switching on a suffix: `bot-core`'s registry splits a custom
 * id into `name:state` on the first colon and routes on the name, so a suffix would be a second parser living
 * outside the registry's contract.
 *
 * Here rather than in the bot because the API posts the card, and a card whose ids the bot doesn't recognise
 * is a card with three dead buttons.
 */
export const APPEAL_COMPONENT = {
	approve: 'appeal-approve',
	deny: 'appeal-deny',
	denySilent: 'appeal-deny-silent',
} as const;

/**
 * Three buttons, not four. "Ask for more info" was in the original P4 plan and was cut before it shipped: the
 * follow-up question would have lived in `appeal_events`, which no appellant-facing route reads, so the
 * appellant could never have seen it or answered it. The status and the two event kinds that went with it are
 * gone from the schema too -- see the migration that dropped them.
 */

/**
 * Amber while it waits on somebody, then the colour of what was decided. A denial and a silent denial share
 * one colour deliberately: the difference between them is stated in words on the card, and a moderator
 * skimming for red should find both.
 */
const STATUS_COLORS: Record<AppealStatusName, number> = {
	PENDING: 0xf5_9e_0b,
	APPROVED: 0x57_f2_87,
	DENIED: 0xed_45_45,
	// Grey with the withdrawal: neither is a decision anybody made, and both mean the same thing to a moderator
	// reading the channel -- there is nothing here to do.
	MOOT: 0x4f_54_5c,
	WITHDRAWN: 0x4f_54_5c,
};

const STATUS_LABELS: Record<AppealStatusName, string> = {
	PENDING: 'Awaiting a decision',
	APPROVED: 'Approved',
	DENIED: 'Denied',
	MOOT: 'Closed, the ban was lifted',
	WITHDRAWN: 'Withdrawn by the appellant',
};

/**
 * How much of the ban reason the card shows. Discord's own cap is 512, and the whole description has 4096 to
 * share with the decision block.
 */
const BAN_REASON_LIMIT = 512;

/**
 * An answer arrives already capped at `APPEAL_ANSWER_MAX_LENGTH` (1024), which is exactly Discord's cap for
 * the embed field value it becomes -- and the code fence around it costs 8 characters more. Trimming by that
 * difference is what stops a maximum-length answer from 400ing the whole message. It bounds the *fenced*
 * string: see `block`.
 */
const ANSWER_LIMIT = APPEAL_ANSWER_MAX_LENGTH - 8;

/**
 * The appeal itself, as the card reads it.
 */
export interface AppealEmbedInput {
	createdAt: Date;
	decidedAt: Date | null;
	decidedById: string | null;
	decisionReason: string | null;
	id: number;
	reasonSnapshot: string | null;
	silent: boolean;
	status: AppealStatusName;
	userId: string;
}

/**
 * One row of `appeal_answers`, carrying the prompt it answered rather than a question id (decision 7) -- so a
 * questionnaire edited later never rewrites what the card says somebody was asked.
 */
export interface AppealAnswerInput {
	answer: string;
	position: number;
	promptSnapshot: string;
}

export interface AppealCardOptions {
	readonly answers: readonly AppealAnswerInput[];
	/**
	 * The appellant's avatar, already resolved to a url by the caller. Passed in for the same reason as
	 * `ReportCardOptions.targetAvatarURL`: the row stores neither an avatar nor a tag, because an appeal
	 * outlives both.
	 */
	readonly appellantAvatarURL?: string;
	/**
	 * What to call the appellant. Absent renders the id alone, which is what an account Discord could not
	 * resolve gets -- an appellant is by definition not in the guild, so this lookup fails more often here than
	 * anywhere else in the product.
	 */
	readonly appellantTag?: string;
	/**
	 * Link to this appeal on the dashboard. Passed in rather than derived here so this stays a pure function of
	 * the row -- `getContext()` in an embed builder is what makes it untestable without a live context. Absent
	 * simply drops the button.
	 */
	readonly dashboardLink?: string;
}

/**
 * Wrapped in a code block, like a reported message and for the same reason: an appeal answer is prose typed by
 * somebody with every motive to dress their text up as the bot's. Markdown inside it renders in *our* embed
 * otherwise, and a fake "verified by staff" line is a one-sentence exploit.
 *
 * **Fenced before it is truncated, not after.** `fence()` grows what it is given -- every ``` gains a
 * zero-width space -- so bounding the input bounds the wrong number: a full-length answer made of backticks
 * comes out a third longer than its limit and Discord rejects the whole message. Truncating the fenced string
 * cannot reintroduce a fence either, since no substring of a string without ``` contains one.
 */
function block(content: string, limit: number): string {
	const trimmed = content.trim();

	return trimmed.length ? `\`\`\`\n${truncate(fence(trimmed), limit)}\n\`\`\`` : '*They left this blank.*';
}

function describeDecision(appeal: AppealEmbedInput): string | null {
	if (appeal.status === 'PENDING') {
		return null;
	}

	if (appeal.status === 'WITHDRAWN') {
		return '**Withdrawn by the appellant.**';
	}

	if (appeal.status === 'MOOT') {
		// Deliberately does not say who lifted it: `GUILD_BAN_REMOVE` carries no actor, and guessing from the
		// audit log would need a permission Appeals does not ask for.
		return '**Closed automatically.** This ban was lifted somewhere other than here, so there was nothing left to decide.';
	}

	const who = appeal.decidedById ? `<@${appeal.decidedById}>` : 'a moderator';
	const verb = appeal.status === 'APPROVED' ? 'Approved' : 'Denied';
	// A relative timestamp rather than the embed's own, which belongs to the *submission* -- "denied 3 days
	// ago" on an appeal filed a month ago is two different facts and the card shows both.
	const when = appeal.decidedAt ? ` <t:${Math.floor(appeal.decidedAt.getTime() / 1_000)}:R>` : '';

	const parts = [`**${verb} by ${who}**${when}.`];

	// The wording is the whole point of a silent denial being distinguishable here: the appeal is closed, the
	// appellant's own page still reads "under review" and will forever, and a second moderator reaching out to
	// explain the decision is what blows it (decision 6).
	if (appeal.silent) {
		parts.push(
			'**Silently.** They were never told, their page still reads "under review", and it always will. Do not contact them about this appeal.',
		);
	}

	if (appeal.decisionReason) {
		parts.push(`Reason: ${block(appeal.decisionReason, BAN_REASON_LIMIT)}`);
	}

	return parts.join('\n');
}

export function buildAppealEmbed(appeal: AppealEmbedInput, options: AppealCardOptions): APIEmbed {
	const banReason = appeal.reasonSnapshot?.trim().length
		? block(appeal.reasonSnapshot, BAN_REASON_LIMIT)
		: '*Discord had no reason recorded for the ban.*';

	const parts = [
		`<@${appeal.userId}> is appealing their ban.`,
		`**Ban reason at the time they appealed**\n${banReason}`,
	];

	const decision = describeDecision(appeal);
	if (decision) {
		parts.push(decision);
	}

	return {
		color: STATUS_COLORS[appeal.status],
		author: {
			name: options.appellantTag ? `${options.appellantTag} (${appeal.userId})` : appeal.userId,
			...(options.appellantAvatarURL ? { icon_url: options.appellantAvatarURL } : {}),
		},
		description: parts.join('\n\n'),
		// Capped at five by `APPEAL_QUESTION_MAX_COUNT`, which exists precisely so the whole questionnaire fits
		// one embed -- see its comment for the arithmetic.
		fields: [...options.answers]
			.sort((left, right) => left.position - right.position)
			.map((answer) => ({
				name: truncate(answer.promptSnapshot, APPEAL_QUESTION_PROMPT_MAX_LENGTH),
				value: block(answer.answer, ANSWER_LIMIT),
			})),
		footer: { text: `Appeal ${appeal.id} | ${STATUS_LABELS[appeal.status]}` },
		timestamp: appeal.createdAt.toISOString(),
	};
}

export function buildAppealComponents(
	appeal: AppealEmbedInput,
	options: Pick<AppealCardOptions, 'dashboardLink'> = {},
): APIMessageTopLevelComponent[] {
	// Every decision is terminal -- there is no reopening an appeal, because the appellant has been told (or
	// deliberately not told) what was decided. A decided card keeps its buttons visible and disabled rather than
	// losing them, so the row reads as "this was handled" rather than as a card that failed to render.
	const decided = appeal.status !== 'PENDING';

	const row: APIActionRowComponent<APIButtonComponent> = {
		type: ComponentType.ActionRow,
		components: [
			// First, and a link button rather than a handled one, so "go read the whole thing" costs no
			// interaction and stays live on a decided card -- a link button cannot be disabled, which is right
			// here: the history is worth reading long after the decision.
			...(options.dashboardLink
				? [
						{
							type: ComponentType.Button as const,
							style: ButtonStyle.Link as const,
							label: 'View in dashboard',
							url: options.dashboardLink,
						},
					]
				: []),
			{
				type: ComponentType.Button as const,
				style: ButtonStyle.Success as const,
				label: 'Approve',
				custom_id: `${APPEAL_COMPONENT.approve}:${appeal.id}`,
				disabled: decided,
			},
			{
				type: ComponentType.Button as const,
				style: ButtonStyle.Danger as const,
				label: 'Deny',
				custom_id: `${APPEAL_COMPONENT.deny}:${appeal.id}`,
				disabled: decided,
			},
			{
				type: ComponentType.Button as const,
				// Secondary rather than a second red button: the two denials differ in who finds out, not in
				// severity, and two identical-looking danger buttons side by side is how the wrong one gets clicked.
				style: ButtonStyle.Secondary as const,
				label: 'Deny silently',
				custom_id: `${APPEAL_COMPONENT.denySilent}:${appeal.id}`,
				disabled: decided,
			},
		],
	};

	return [row];
}

/**
 * The thread (or forum post) an appeal's embed lives on. Discord caps a channel name at 100.
 */
export function buildAppealThreadName(appeal: Pick<AppealEmbedInput, 'id' | 'userId'>, appellantTag?: string): string {
	return truncate(`Appeal ${appeal.id} - ${appellantTag ?? appeal.userId}`, 100);
}
