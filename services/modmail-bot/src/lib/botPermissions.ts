import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { getSelfId } from '@chatsift/bot-core';
import { computeChannelPermissions, permissionNames } from '@chatsift/core';
import { PermissionFlagsBits } from '@discordjs/core';

export interface PermissionRequirement {
	breaks: string;
	permission: bigint;
}

export const MOD_FORUM_PERMISSIONS: readonly PermissionRequirement[] = [
	{ permission: PermissionFlagsBits.ViewChannel, breaks: 'seeing this channel at all' },
	{ permission: PermissionFlagsBits.SendMessages, breaks: 'opening new tickets here' },
	{
		permission: PermissionFlagsBits.SendMessagesInThreads,
		breaks: 'relaying messages into ticket threads, and keeping them from auto-archiving',
	},
	{ permission: PermissionFlagsBits.EmbedLinks, breaks: 'ticket info, greetings and relayed messages' },
	{ permission: PermissionFlagsBits.AttachFiles, breaks: 'images and files sent by the user' },
	{ permission: PermissionFlagsBits.ReadMessageHistory, breaks: 'reply context, and syncing edits and deletes' },
	{ permission: PermissionFlagsBits.ManageMessages, breaks: 'the "Reply with this message" context-menu command' },
	{ permission: PermissionFlagsBits.ManageThreads, breaks: 'closing tickets, which archives and locks the thread' },
];

export async function findMissingPermissions(
	guildId: string,
	channelId: string,
	requirements: readonly PermissionRequirement[],
	logger: Logger,
): Promise<PermissionRequirement[] | null> {
	try {
		const { api } = getContext().service.client;
		const botUserId = await getSelfId(api);
		const [guild, channel, botMember] = await Promise.all([
			api.guilds.get(guildId),
			api.channels.get(channelId),
			api.guilds.getMember(guildId, botUserId),
		]);

		const permissions = computeChannelPermissions({
			guildId,
			guildOwnerId: guild.owner_id,
			memberId: botUserId,
			memberRoleIds: botMember.roles,
			overwrites: 'permission_overwrites' in channel ? (channel.permission_overwrites ?? []) : [],
			roles: guild.roles,
		});

		return requirements.filter((requirement) => (permissions & requirement.permission) === 0n);
	} catch (error) {
		logger.warn({ err: error, guildId, channelId }, 'Failed to check the bot permissions for a channel');
		return null;
	}
}

export function formatMissingPermissionsNotice(missing: readonly PermissionRequirement[], channelId: string): string {
	const lines = missing.map(
		(requirement) => `-# • **${permissionNames(requirement.permission).join(', ')}** — ${requirement.breaks}`,
	);

	return [
		`-# ⚠️ ModMail is missing permissions in <#${channelId}>, so parts of this ticket won't work:`,
		...lines,
	].join('\n');
}
