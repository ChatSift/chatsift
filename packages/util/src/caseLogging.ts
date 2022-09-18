import { addFields, truncateEmbed } from '@chatsift/discord-utils';
import { makeDiscordCdnUrl } from '@cordis/util';
import ms from '@naval-base/ms';
import type { Case } from '@prisma/client';
import type { APIEmbed, APIMessage, APIUser, Snowflake } from 'discord-api-types/v9';
import { RouteBases } from 'discord-api-types/v9';

export const LOG_COLORS = Object.freeze({
	warn: 16_022_395,
	mute: 16_022_395,
	unmute: 5_793_266,
	kick: 16_022_395,
	softban: 16_022_395,
	ban: 15_747_144,
	unban: 5_793_266,
} as const);

export const ACTIONS = Object.freeze({
	warn: 'warned',
	mute: 'muted',
	unmute: 'unmuted',
	kick: 'kicked',
	softban: 'softbanned',
	ban: 'banned',
	unban: 'unbanned',
} as const);

export type CaseEmbedOptions = {
	cs: Case;
	logChannelId?: Snowflake | null;
	message?: APIMessage | null;
	mod?: APIUser | null;
	pardonedBy?: APIUser | null;
	refCs?: Case | null;
	target: APIUser;
};

export const makeCaseEmbed = ({
	logChannelId,
	cs,
	target,
	mod,
	pardonedBy,
	message,
	refCs: ref,
}: CaseEmbedOptions): APIEmbed => {
	const embed: APIEmbed = message?.embeds[0]
		? message.embeds[0]
		: {
				color: LOG_COLORS[cs.actionType],
				author: {
					name: `${cs.targetTag} (${cs.targetId})`,
					icon_url: target.avatar
						? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${target.id}/${target.avatar}`)
						: `${RouteBases.cdn}/embed/avatars/${Number.parseInt(target.discriminator, 10) % 5}.png`,
				},
		  };

	// Set seperately so they are processed even on case updates in case mod data was missed for whatever reason
	embed.title = `Was ${ACTIONS[cs.actionType]}${cs.reason ? ` for ${cs.reason}` : ''}`;
	embed.footer = {
		text: `Case ${cs.caseId}${cs.modTag ? ` | By ${cs.modTag} (${cs.modId!})` : ''}`,
		icon_url: mod
			? mod.avatar
				? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${mod.id}/${mod.avatar}`)
				: `${RouteBases.cdn}/embed/avatars/${Number.parseInt(mod.discriminator, 10) % 5}.png`
			: undefined,
	};

	if (cs.refId && ref && !embed.fields?.length) {
		addFields(embed, {
			name: 'Reference',
			value:
				ref.logMessageId && logChannelId
					? `[#${ref.caseId}](https://discord.com/channels/${cs.guildId}/${logChannelId}/${ref.logMessageId})`
					: `#${ref.caseId}`,
		});
	}

	if (pardonedBy) {
		addFields(embed, {
			name: 'Pardoned by',
			value: `${pardonedBy.username}#${pardonedBy.discriminator}`,
		});
	}

	if (cs.expiresAt) {
		const expiresAt = new Date(cs.expiresAt).getTime();
		addFields(embed, {
			name: 'Duration',
			value: `${ms(expiresAt - new Date(cs.createdAt).getTime(), true)}; Expires: <t:${Math.round(
				expiresAt / 1_000,
			)}:R>`,
		});
	}

	return truncateEmbed(embed);
};

export type HistoryEmbedOptions = {
	cases: Case[];
	filterTriggers?: number;
	logChannelId?: Snowflake | null;
	user: APIUser;
};

// The severity color system - bans = 3pt; kicks/softbans = 2pts; mutes = 0.5pts; warnings = 0.25pts;
//  >=3 points -> red
//  >=2 points -> orange
//  >0 points -> yellow
//  =0 points -> green

export const makeHistoryEmbed = ({ user, cases, logChannelId, filterTriggers }: HistoryEmbedOptions): APIEmbed => {
	let points = 0;
	const counts = {
		ban: 0,
		kick: 0,
		mute: 0,
		warn: 0,
	};

	const colors = [8_450_847, 13_091_073, 16_022_395, 15_747_144] as const;
	const details: string[] = [];

	for (const cs of cases.sort((a, b) => a.id - b.id)) {
		if (cs.actionType === 'ban') {
			counts.ban++;
			points += 3;
		} else if (['kick', 'softban'].includes(cs.actionType)) {
			counts.kick++;
			points += 2;
		} else if (cs.actionType === 'mute') {
			counts.mute++;
			points += 0.5;
		} else if (cs.actionType === 'warn') {
			counts.warn++;
			points += 0.25;
		} else {
			continue;
		}

		const timestamp = Math.round(cs.createdAt.getTime() / 1_000);
		const action = cs.actionType.toUpperCase();
		const caseId =
			cs.logMessageId && logChannelId
				? `[#${cs.caseId}](https://discord.com/channels/${cs.guildId}/${logChannelId}/${cs.logMessageId})`
				: `#${cs.caseId}`;
		const reason = cs.reason ? ` - ${cs.reason}` : '';

		details.push(`• <t:${timestamp}:D> \`${action}\` ${caseId}${reason}`);
	}

	const embed: APIEmbed = {
		author: {
			name: `${user.username}#${user.discriminator} (${user.id})`,
			icon_url: user.avatar
				? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${user.id}/${user.avatar}`)
				: `${RouteBases.cdn}/embed/avatars/${Number.parseInt(user.discriminator, 10) % 5}.png`,
		},
		color: colors[points > 0 && points < 1 ? 1 : Math.min(Math.floor(points), 3)],
	};

	const footer = Object.entries(counts)
		.reduce<string[]>(
			(arr, [type, count]) => {
				if (count > 0) {
					arr.push(`${count} ${type}${count === 1 ? '' : 's'}`);
				}

				return arr;
			},
			filterTriggers ? [`${filterTriggers} Filter trigger${filterTriggers === 1 ? '' : 's'}`] : [],
		)
		.join(' | ');

	if (footer.length) {
		embed.footer = { text: footer };
		embed.description = details.join('\n');
	} else {
		embed.description = 'User has not been punished before.';
	}

	return embed;
};
