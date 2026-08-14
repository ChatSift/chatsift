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
 * Structurally satisfied by an `automoderator_cases` row, minus its branded id and the action's enum type.
 */
export interface CaseEmbedInput {
	readonly actionType: CaseActionName;
	readonly caseId: number;
	readonly createdAt: Date;
	readonly dryRun: boolean;
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
}

const TITLE_LIMIT = 256;

function truncate(value: string, limit: number): string {
	return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export function buildCaseEmbed(modCase: CaseEmbedInput, options: CaseEmbedOptions = {}): APIEmbed {
	const fields: NonNullable<APIEmbed['fields']> = [];

	if (modCase.refId !== null) {
		const { reference, logChannelId } = options;
		// Deep-links to the referenced case's own log message when there is one, so a moderator reading a
		// history can jump between related cases instead of searching for a number.
		const link =
			reference?.logMessageId && logChannelId
				? `[#${modCase.refId}](https://discord.com/channels/${modCase.guildId}/${logChannelId}/${reference.logMessageId})`
				: `#${modCase.refId}`;

		fields.push({ name: 'Reference', value: link, inline: true });
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

	// Says out loud that nothing actually happened. Only ever reachable outside production, but a log line
	// claiming a ban that was suppressed is precisely the confusion dry-run exists to avoid causing.
	if (modCase.dryRun) {
		fields.push({ name: 'Dry run', value: 'No Discord action was taken.', inline: false });
	}

	return {
		color: LOG_COLORS[modCase.actionType],
		author: { name: `${modCase.targetTag} (${modCase.targetId})` },
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
