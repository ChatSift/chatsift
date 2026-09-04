import type { APIEmbed } from 'discord-api-types/v10';

/**
 * The mod-log embed, shared by `services/automoderator-bot` (which posts it) and `services/api` (which
 * rewrites it when a case is amended from the dashboard). Two producers of the same message means the builder
 * has to live somewhere neither owns, exactly like `amaEmbeds.ts`.
 *
 * Takes a structural shape rather than `@chatsift/db`'s `AutomoderatorCases`: this package is depended on by
 * `apps/website` and must not pull the database client in behind it.
 */

/**
 * Mirrors `CREATE TYPE automoderator_case_action`. A string union rather than the generated enum, for the
 * dependency reason above -- call sites holding a row pass `row.actionType as CaseActionName`, the same cast
 * the other kanel enums already need (see `ama/constants.ts`).
 */
export type CaseActionName = 'BAN' | 'KICK' | 'MUTE' | 'SOFTBAN' | 'UNBAN' | 'UNMUTE' | 'WARN';

/**
 * Past-tense wording, shared by the DM, the command reply and the log embed so they can't drift.
 */
export const ACTION_PAST_TENSE: Record<CaseActionName, string> = {
	WARN: 'warned',
	MUTE: 'muted',
	UNMUTE: 'unmuted',
	KICK: 'kicked',
	SOFTBAN: 'softbanned',
	BAN: 'banned',
	UNBAN: 'unbanned',
};

/**
 * Per-action embed colours, carried over from legacy so a migrated guild's log doesn't change appearance
 * mid-history at P9.
 */
export const LOG_COLORS: Record<CaseActionName, number> = {
	WARN: 0xfe_e7_5c,
	MUTE: 0xf5_9e_0b,
	UNMUTE: 0x57_f2_87,
	KICK: 0xed_45_45,
	SOFTBAN: 0xed_45_45,
	BAN: 0x99_24_1f,
	UNBAN: 0x57_f2_87,
};

/**
 * Rough human duration, for a DM and an embed field. Deliberately coarse -- "2 days" reads better than
 * "1 day 23 hours 59 minutes", and the exact expiry is always rendered as a Discord timestamp alongside it.
 */
export function formatCaseDuration(ms: number): string {
	const units: [string, number][] = [
		['day', 86_400_000],
		['hour', 3_600_000],
		['minute', 60_000],
		['second', 1_000],
	];

	for (const [name, size] of units) {
		if (ms >= size) {
			const value = Math.round(ms / size);
			return `${value} ${name}${value === 1 ? '' : 's'}`;
		}
	}

	return 'a moment';
}

export function formatCaseUserTag(user: { discriminator?: string | null; username: string }): string {
	return user.discriminator === '0' || !user.discriminator ? user.username : `${user.username}#${user.discriminator}`;
}

/**
 * Where a case's own mod-log message is, as far as a jump link is concerned.
 *
 * `logChannelId` is the channel the *message is in*, which for a mod log pointed at a thread is the thread
 * rather than `automoderator_log_webhooks.channel_id` -- that column holds the thread's *parent*, because a
 * webhook belongs to the parent and reaches the thread through `?thread_id=`. Resolving the two is
 * {@link logJumpChannelId}.
 */
export interface CaseLogLocation {
	readonly guildId: string;
	readonly logChannelId?: string | null | undefined;
	readonly logMessageId?: string | null | undefined;
}

/**
 * Turns an `automoderator_log_webhooks` row into the channel a jump link to its messages has to name.
 *
 * The other half of the rule {@link CaseLogLocation} states: `channel_id` holds the thread's *parent* whenever
 * the log is pointed at a thread, so a link built from that column resolves to nothing for those guilds. Here
 * rather than in either service because both of them build these links -- the bot for its replies and logs, the
 * API when it rewrites a case embed the dashboard amended.
 */
export function logJumpChannelId(
	webhook: { channelId: string; threadId: string | null } | null | undefined,
): string | null {
	return webhook ? (webhook.threadId ?? webhook.channelId) : null;
}

/**
 * `#12`, hyperlinked to the case's own mod-log message wherever there is one to jump to (#381).
 *
 * A case number a moderator reads is nearly always a case they are about to go and look at, and every surface
 * that names one -- a command reply, `/history`, the filter log, another case's Reference field -- is somewhere
 * other than the mod log itself. Falls back to the bare number rather than to nothing: a guild with no mod log
 * configured still has case numbers, they are just not clickable.
 */
export function formatCaseNumber(caseId: number, location?: CaseLogLocation | null): string {
	if (!location?.logChannelId || !location.logMessageId) {
		return `#${caseId}`;
	}

	return `[#${caseId}](https://discord.com/channels/${location.guildId}/${location.logChannelId}/${location.logMessageId})`;
}

/**
 * Structurally satisfied by an `automoderator_cases` row, minus its branded id and the action's enum type.
 */
export interface CaseEmbedInput {
	readonly actionType: CaseActionName;
	readonly caseId: number;
	readonly createdAt: Date;
	readonly expiresAt: Date | null;
	readonly guildId: string;
	readonly modId: string | null;
	readonly modTag: string | null;
	readonly pardonedBy: string | null;
	readonly reason: string | null;
	readonly refId: number | null;
	readonly targetId: string;
	readonly targetTag: string;
}

export interface CaseEmbedOptions {
	/**
	 * The channel the mod log posts into, for the reference deep link.
	 */
	readonly logChannelId?: string | null;
	/**
	 * The case `ref_id` points at, already resolved, so the embed can link to its log message.
	 */
	readonly reference?: { logMessageId: string | null } | null;
	/**
	 * The target's avatar, already resolved to a url by the caller (#377). Passed in rather than derived from
	 * the case row, which stores no avatar: both producers hold a Discord user by the time they build this, and
	 * neither an avatar hash nor a snapshot of one belongs in a table whose whole point is to outlive the
	 * account. Absent leaves the author line without an icon, which is what a user Discord could not resolve
	 * gets.
	 */
	readonly targetAvatarURL?: string;
}

const TITLE_LIMIT = 256;

function truncate(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export function buildCaseEmbed(modCase: CaseEmbedInput, options: CaseEmbedOptions = {}): APIEmbed {
	const fields: NonNullable<APIEmbed['fields']> = [];

	if (modCase.refId !== null) {
		// Deep-links to the referenced case's own log message when there is one, so a moderator reading a
		// history can jump between related cases instead of searching for a number.
		fields.push({
			name: 'Reference',
			value: formatCaseNumber(modCase.refId, {
				guildId: modCase.guildId,
				logChannelId: options.logChannelId,
				logMessageId: options.reference?.logMessageId,
			}),
			inline: true,
		});
	}

	if (modCase.expiresAt) {
		const seconds = Math.floor(modCase.expiresAt.getTime() / 1_000);
		fields.push({
			name: 'Duration',
			value: `${formatCaseDuration(
				modCase.expiresAt.getTime() - modCase.createdAt.getTime(),
			)} (expires <t:${seconds}:R>)`,
			inline: true,
		});
	}

	if (modCase.pardonedBy) {
		fields.push({ name: 'Pardoned by', value: `<@${modCase.pardonedBy}>`, inline: true });
	}

	return {
		color: LOG_COLORS[modCase.actionType],
		author: {
			name: `${modCase.targetTag} (${modCase.targetId})`,
			...(options.targetAvatarURL ? { icon_url: options.targetAvatarURL } : {}),
		},
		title: truncate(
			`Was ${ACTION_PAST_TENSE[modCase.actionType]}${modCase.reason ? ` for ${modCase.reason}` : ''}`,
			TITLE_LIMIT,
		),
		footer: {
			text: `Case ${modCase.caseId}${modCase.modTag ? ` | By ${modCase.modTag} (${modCase.modId})` : ''}`,
		},
		timestamp: modCase.createdAt.toISOString(),
		...(fields.length > 0 ? { fields } : {}),
	};
}
