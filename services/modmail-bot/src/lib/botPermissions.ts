import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { getSelfId } from '@chatsift/bot-core';
import { computeChannelPermissions, permissionNames } from '@chatsift/core';
import { PermissionFlagsBits } from '@discordjs/core';

export interface PermissionRequirement {
	breaks: string;
	permission: bigint;
}

export interface ChannelRequirements {
	channelId: string;
	requirements: readonly PermissionRequirement[];
}

export interface MissingChannelPermissions {
	channelId: string;
	missing: PermissionRequirement[];
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

/**
 * The user's side of a panel ticket is a private thread in the panel's own channel, and a thread carries no
 * permission overwrites of its own -- everything the bot can or can't do in it is decided here, on the parent.
 * Checked alongside `MOD_FORUM_PERMISSIONS` at ticket-open time because the failures it causes otherwise
 * surface nowhere a moderator can see: `ManageThreads` in particular isn't needed until the ticket *closes*
 * (locking the thread) and then again when `guild_settings.nuke_delay_minutes` lapses (deleting it), so a guild
 * missing it gets a working ticket that quietly never cleans up after itself -- the sweep retries hourly and
 * gives up on nothing (`lib/threadNukeSweep.ts`).
 */
export const PANEL_CHANNEL_PERMISSIONS: readonly PermissionRequirement[] = [
	{ permission: PermissionFlagsBits.ViewChannel, breaks: 'seeing the channel this ticket was opened from' },
	{ permission: PermissionFlagsBits.CreatePrivateThreads, breaks: 'opening a ticket thread at all' },
	{ permission: PermissionFlagsBits.SendMessagesInThreads, breaks: 'relaying staff replies to the user' },
	{
		permission: PermissionFlagsBits.ManageThreads,
		breaks: "locking this ticket's thread when it closes, and deleting it after the configured delay",
	},
	{ permission: PermissionFlagsBits.EmbedLinks, breaks: 'greetings and staff replies, which are sent as embeds' },
	{ permission: PermissionFlagsBits.AttachFiles, breaks: 'images and files staff send back to the user' },
	{ permission: PermissionFlagsBits.ReadMessageHistory, breaks: 'reply context on the user side' },
];

/**
 * Takes every channel to check in one call rather than one call per channel: the guild and the bot's own
 * member are the expensive half of computing this and are identical for all of them, so checking the mod
 * forum and a ticket's panel channel together costs one extra `channels.get` rather than a second round of
 * all three. Returns only the channels actually missing something, or `null` if the check itself couldn't be
 * completed -- an advisory notice must never be built out of a failed lookup.
 */
export async function findMissingPermissions(
	guildId: string,
	checks: readonly ChannelRequirements[],
	logger: Logger,
): Promise<MissingChannelPermissions[] | null> {
	if (checks.length === 0) {
		return [];
	}

	try {
		const { api } = getContext().service.client;
		const botUserId = await getSelfId(api);
		const [guild, botMember, ...channels] = await Promise.all([
			api.guilds.get(guildId),
			api.guilds.getMember(guildId, botUserId),
			...checks.map(async (check) => api.channels.get(check.channelId)),
		]);

		return checks
			.map((check, index) => {
				const channel = channels[index]!;
				const permissions = computeChannelPermissions({
					guildId,
					guildOwnerId: guild.owner_id,
					memberId: botUserId,
					memberRoleIds: botMember.roles,
					overwrites: 'permission_overwrites' in channel ? (channel.permission_overwrites ?? []) : [],
					roles: guild.roles,
				});

				return {
					channelId: check.channelId,
					missing: check.requirements.filter((requirement) => (permissions & requirement.permission) === 0n),
				};
			})
			.filter((result) => result.missing.length > 0);
	} catch (error) {
		logger.warn(
			{ err: error, guildId, channelIds: checks.map((check) => check.channelId) },
			'Failed to check the bot permissions for a channel',
		);
		return null;
	}
}

export function formatMissingPermissionsNotice(results: readonly MissingChannelPermissions[]): string {
	return results
		.flatMap((result) => [
			`-# ⚠️ ModMail is missing permissions in <#${result.channelId}>, so parts of this ticket won't work:`,
			...result.missing.map(
				(requirement) => `-# • **${permissionNames(requirement.permission).join(', ')}** — ${requirement.breaks}`,
			),
		])
		.join('\n');
}
