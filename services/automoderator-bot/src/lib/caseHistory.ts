import { displayAvatarURL, formatCaseNumber } from '@chatsift/core';
import type { AutomoderatorCaseAction, AutomoderatorCases } from '@chatsift/db';
import type { APIEmbed, APIUser } from '@discordjs/core';

// TODO: Maybe add more logic behind this
const SEVERITY_POINTS: Record<AutomoderatorCaseAction, number> = {
	BAN: 3,
	SOFTBAN: 2,
	KICK: 2,
	MUTE: 0.5,
	WARN: 0.25,
	UNMUTE: 0,
	UNBAN: 0,
};

const SEVERITY_COLORS = {
	clean: 0x57_f2_87,
	low: 0xfe_e7_5c,
	medium: 0xf5_9e_0b,
	high: 0xed_45_45,
} as const;

function severityColor(cases: readonly AutomoderatorCases[]): number {
	const points = cases.reduce((total, entry) => total + SEVERITY_POINTS[entry.actionType], 0);

	if (points >= 3) return SEVERITY_COLORS.high;
	if (points >= 2) return SEVERITY_COLORS.medium;
	if (points > 0) return SEVERITY_COLORS.low;
	return SEVERITY_COLORS.clean;
}

function summarize(cases: readonly AutomoderatorCases[]): string {
	const counts = new Map<AutomoderatorCaseAction, number>();

	for (const entry of cases) {
		counts.set(entry.actionType, (counts.get(entry.actionType) ?? 0) + 1);
	}

	return [...counts].map(([action, count]) => `${count} ${action.toLowerCase()}${count === 1 ? '' : 's'}`).join(' | ');
}

const MAX_LISTED = 15;

export interface HistoryEmbedOptions {
	readonly logChannelId?: string | null;
}

export function buildHistoryEmbed(
	user: APIUser,
	cases: readonly AutomoderatorCases[],
	options: HistoryEmbedOptions = {},
): APIEmbed {
	const active = cases.filter((entry) => entry.pardonedBy === null);
	// The one embed here that is built straight from a Discord payload rather than from a row, so the avatar
	// (#377) costs nothing -- `/history`, `/myhistory` and the History context menu all hand over a resolved user.
	const author = { name: `${user.username} (${user.id})`, icon_url: displayAvatarURL(user.id, user.avatar) };

	if (active.length === 0) {
		return {
			color: SEVERITY_COLORS.clean,
			author,
			description: 'This user has not been punished before.',
		};
	}

	const listed = active.slice(0, MAX_LISTED).map((entry) => {
		const timestamp = Math.floor(entry.createdAt.getTime() / 1_000);
		const reason = entry.reason ? ` — ${entry.reason}` : '';
		const number = formatCaseNumber(entry.caseId, {
			guildId: entry.guildId,
			logChannelId: options.logChannelId,
			logMessageId: entry.logMessageId,
		});

		return `• <t:${timestamp}:D> \`${entry.actionType.toLowerCase()}\` ${number}${reason}`;
	});

	const remaining = active.length - listed.length;
	const description = remaining > 0 ? `${listed.join('\n')}\n\n…and ${remaining} more.` : listed.join('\n');

	return {
		color: severityColor(active),
		author,
		description,
		footer: { text: summarize(active) },
	};
}
