import type {
	APIActionRowComponent,
	APIButtonComponent,
	APIEmbed,
	APIMessageTopLevelComponent,
} from 'discord-api-types/v10';
import { ButtonStyle, ComponentType } from 'discord-api-types/v10';

/**
 * The report card, shared by `services/automoderator-bot` (which posts it for the two guild context menus and
 * rewrites it on every button) and `services/api` (which posts it for a DM report confirmed on the website,
 * P3b). Two producers of the same message means the builder has to live somewhere neither owns, exactly like
 * `automoderatorCaseEmbeds.ts`.
 *
 * Takes structural shapes rather than `@chatsift/db`'s row types: this package is depended on by
 * `apps/website` and must not pull the database client in behind it.
 */

/**
 * Mirrors `CREATE TYPE automoderator_report_state` / `automoderator_report_origin`. String unions rather than
 * the generated enums, for the dependency reason above -- call sites holding a row cast, the same way
 * `CaseActionName` already needs.
 */
export type ReportStateName = 'ACTIONED' | 'DISMISSED' | 'OPEN';
export type ReportOriginName = 'DM' | 'GUILD';

/**
 * Custom-id prefixes for the card's buttons. Each is a separate registered `ComponentHandler` in the bot,
 * rather than one handler switching on a suffix: `bot-core`'s registry splits a custom id into `name:state`
 * and routes on the name, so a suffix would be a second parser living outside the registry's contract.
 *
 * Here rather than in the bot because the API posts cards too, and a card whose ids the bot doesn't recognise
 * is a card with four dead buttons.
 */
export const REPORT_COMPONENT = {
	dismiss: 'report-dismiss',
	reporters: 'report-reporters',
	action: 'report-action',
	actionSelect: 'report-action-select',
} as const;

/**
 * What the Action button offers. Legacy's set minus its `noop` option, which set the same
 * acknowledged-and-no-punishment state the Dismiss button already produces -- two routes to one outcome is
 * worth not porting.
 */
export const REPORT_ACTION_OPTIONS = [
	{ action: 'WARN', label: 'Warn', description: 'Record a warning and DM them' },
	{ action: 'MUTE', label: 'Mute', description: 'Time them out for a duration you pick' },
	{ action: 'KICK', label: 'Kick', description: 'Remove them from the server' },
	{ action: 'BAN', label: 'Ban', description: 'Ban them, permanently or for a duration you pick' },
] as const;

export type ReportActionName = (typeof REPORT_ACTION_OPTIONS)[number]['action'];

export function isReportAction(value: string): value is ReportActionName {
	return REPORT_ACTION_OPTIONS.some((option) => option.action === value);
}

/**
 * Reads back as red while it needs attention, muted once it doesn't. Deliberately *not* drawn from
 * `LOG_COLORS`: those are keyed by case action and mean "how severe was the punishment", which is a different
 * axis from "does this still need a moderator".
 */
const STATE_COLORS: Record<ReportStateName, number> = {
	OPEN: 0xed_45_45,
	DISMISSED: 0x4f_54_5c,
	ACTIONED: 0x57_f2_87,
};

const STATE_LABELS: Record<ReportStateName, string> = {
	OPEN: 'Open',
	DISMISSED: 'Dismissed',
	ACTIONED: 'Actioned',
};

/**
 * Discord's embed description cap is 4096, and a reported message can be 4000 characters of its own before the
 * surrounding text. Truncated rather than dropped: a moderator reading the first 1500 characters of a wall of
 * text has what they need to act.
 */
const CONTENT_LIMIT = 1_500;

/**
 * Tighter than {@link CONTENT_LIMIT}, because up to five of these render alongside the subject and Discord caps
 * a *message* at 6000 characters across every embed on it. 1500 + 5 x 500 leaves comfortable headroom.
 */
const CONTEXT_CONTENT_LIMIT = 500;

function truncate(value: string, limit: number): string {
	return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/**
 * Neutralizes a code fence inside reported text.
 *
 * The content is whatever the reported account typed. A literal triple-backtick in it closes the block early and the rest
 * renders as markdown *in the bot's own embed* — which is a spoofing vector, not just a layout glitch: attacker
 * text can be dressed up as something the bot said, a fake "verified" link being the obvious use. A zero-width
 * space between the backticks stops the fence from closing while leaving the text readable.
 */
function fence(value: string): string {
	return value.replaceAll('```', '`\u200B``');
}

function block(content: string | null, limit: number): string {
	return content?.trim().length
		? `\`\`\`\n${fence(truncate(content, limit))}\n\`\`\``
		: '*The message had no text content.*';
}

/**
 * The report itself, as the card reads it.
 */
export interface ReportEmbedInput {
	channelId: string | null;
	createdAt: Date;
	guildId: string;
	id: number;
	messageContent: string | null;
	messageId: string | null;
	messageImageUrl: string | null;
	origin: ReportOriginName;
	state: ReportStateName;
	targetId: string;
	targetTag: string;
}

/**
 * One row of `automoderator_report_messages` -- a message the reporter added beyond the subject one. Its author
 * is carried explicitly because it may be the *reporter*, not the target.
 */
export interface ReportContextMessageInput {
	authorId: string;
	authorTag: string;
	content: string | null;
	imageUrl: string | null;
	messageId: string;
}

/**
 * Whether staff can actually follow a link to the reported message. Keyed on `origin` rather than on the
 * channel id being present: a DM-origin report has a channel id nobody but the two participants can open, so
 * rendering a link for it would be a button that always fails.
 */
export function isReportLinkable(report: Pick<ReportEmbedInput, 'channelId' | 'messageId' | 'origin'>): boolean {
	return report.origin === 'GUILD' && Boolean(report.messageId) && Boolean(report.channelId);
}

function describeSubject(report: ReportEmbedInput): string {
	if (!report.messageId) {
		return 'Was reported.';
	}

	const where = isReportLinkable(report) ? ` in <#${report.channelId}>` : '';

	return `Had a message${where} reported.\n\n${block(report.messageContent, CONTENT_LIMIT)}`;
}

/**
 * How a context message's author is described on the card. Deliberately exhaustive rather than
 * target-or-reporter: a group DM has participants who are neither.
 */
function describeContextAuthor(
	message: ReportContextMessageInput,
	report: ReportEmbedInput,
	reporterId: string | undefined,
): string {
	if (message.authorId === report.targetId) {
		return 'reported account';
	}

	return message.authorId === reporterId ? 'reporter' : 'other participant';
}

export interface ReportCardOptions {
	/**
	 * The messages the reporter added beyond the subject one, in their chosen order. Only a DM report has any.
	 */
	readonly contextMessages?: readonly ReportContextMessageInput[];
	/**
	 * Link to this report on the dashboard. Passed in rather than derived here so this stays a pure function of
	 * the row -- `getContext()` in an embed builder is what makes it untestable without a live context.
	 */
	readonly dashboardLink?: string;
	readonly reporterCount: number;
	/**
	 * The account that opened the report, used to label the context messages they wrote themselves.
	 *
	 * Passed explicitly rather than inferred as "whoever isn't the target". A user-installed context menu runs
	 * in `PRIVATE_CHANNEL`, which is group DMs as well as one-to-one ones, so a draft can legitimately capture
	 * a third participant -- and labelling them as the reporter would tell a moderator that the person filing
	 * the report said something they never said. Absent, everyone who isn't the target is labelled neutrally.
	 */
	readonly reporterId?: string;
	/**
	 * The reported account's avatar, already resolved to a url by the caller (#377). Passed in for the same
	 * reason as `CaseEmbedOptions.targetAvatarURL`: the report row stores a tag snapshot, never an avatar.
	 */
	readonly targetAvatarURL?: string;
}

/**
 * The card's embeds: the subject message first, then one per context message.
 *
 * Separate embeds rather than fields on one, because each context message can carry its own image and an embed
 * holds exactly one. Discord re-hosts every embed image it is handed, which is what keeps a DM report's
 * evidence readable after the original CDN signatures expire.
 */
export function buildReportEmbeds(report: ReportEmbedInput, options: ReportCardOptions): APIEmbed[] {
	const { contextMessages = [], dashboardLink, reporterCount, reporterId } = options;
	const plural = reporterCount === 1 ? 'reporter' : 'reporters';

	const parts = [describeSubject(report)];

	// Stated on the card rather than assumed, because it is the one thing that makes a DM report different in
	// kind: every other report has a jump link a moderator can check against, and this one is trust in a chain
	// of custody they cannot inspect. A moderator who doesn't know that will read it as if they could have.
	if (report.origin === 'DM') {
		parts.push(
			contextMessages.length
				? '*Reported from a DM — these are the messages the reporter chose out of a conversation staff cannot see.*'
				: '*Reported from a DM — this is the message the reporter chose out of a conversation staff cannot see.*',
		);
	}

	if (dashboardLink) {
		// In the description, not the footer: Discord renders no markdown at all in an embed footer, so a link
		// there is unclickable text. Same finding as `/history`'s link at P1.
		parts.push(`[Open this report on the dashboard](${dashboardLink})`);
	}

	const subject: APIEmbed = {
		color: STATE_COLORS[report.state],
		author: {
			name: `${report.targetTag} (${report.targetId})`,
			...(options.targetAvatarURL ? { icon_url: options.targetAvatarURL } : {}),
		},
		description: parts.join('\n\n'),
		footer: {
			text: `Report ${report.id} | ${reporterCount} ${plural} | ${STATE_LABELS[report.state]}`,
		},
		timestamp: report.createdAt.toISOString(),
		// The CDN url is handed to Discord, which re-hosts the image against this message -- which is what keeps
		// the card readable after the original (signed, expiring) url stops resolving.
		...(report.messageImageUrl ? { image: { url: report.messageImageUrl } } : {}),
	};

	return [
		subject,
		...contextMessages.map((message, index): APIEmbed => ({
			color: STATE_COLORS[report.state],
			// Named against the target rather than left bare, so a moderator can tell at a glance which of these
			// the reporter wrote themselves -- the whole reason context messages carry their own author. Three
			// cases, not two: see `reporterId` for why a third participant must not be called the reporter.
			author: { name: `${message.authorTag} (${describeContextAuthor(message, report, reporterId)})` },
			description: block(message.content, CONTEXT_CONTENT_LIMIT),
			footer: { text: `Context ${index + 1} of ${contextMessages.length}` },
			...(message.imageUrl ? { image: { url: message.imageUrl } } : {}),
		})),
	];
}

export function buildReportComponents(report: ReportEmbedInput): APIMessageTopLevelComponent[] {
	const dismissed = report.state === 'DISMISSED';
	// Actioning is terminal: the report produced a case, and that case is the record now. Leaving the buttons
	// live would offer a second punishment for the same report with nothing to stop it.
	const closed = report.state === 'ACTIONED';

	const row: APIActionRowComponent<APIButtonComponent> = {
		type: ComponentType.ActionRow,
		components: [
			// A link button rather than a handled one, so "go look at it" costs no interaction -- and it is
			// omitted entirely for an account-level or DM report, where there is nothing staff can jump to.
			// Legacy shipped a permanently disabled placeholder button there instead.
			...(isReportLinkable(report)
				? [
						{
							type: ComponentType.Button as const,
							style: ButtonStyle.Link as const,
							label: 'Review',
							url: `https://discord.com/channels/${report.guildId}/${report.channelId}/${report.messageId}`,
						},
					]
				: []),
			{
				type: ComponentType.Button as const,
				style: dismissed ? ButtonStyle.Danger : ButtonStyle.Success,
				label: dismissed ? 'Restore' : 'Dismiss',
				custom_id: `${REPORT_COMPONENT.dismiss}:${report.id}`,
				disabled: closed,
			},
			{
				type: ComponentType.Button as const,
				style: ButtonStyle.Primary as const,
				label: 'View reporters',
				custom_id: `${REPORT_COMPONENT.reporters}:${report.id}`,
			},
			{
				type: ComponentType.Button as const,
				style: ButtonStyle.Danger as const,
				label: 'Action',
				custom_id: `${REPORT_COMPONENT.action}:${report.id}`,
				disabled: closed,
			},
		],
	};

	return [row];
}
