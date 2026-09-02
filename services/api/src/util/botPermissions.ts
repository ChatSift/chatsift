import type { BotId, Logger } from '@chatsift/backend-core';
import { computeChannelPermissions, permissionNames } from '@chatsift/core';
import type { Snowflake } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { badRequest } from '@hapi/boom';
import { apiForGuild } from './discordAPI.js';
import { getBotApplicationId } from './discordApplication.js';

/**
 * Rejects a config field naming a channel the bot can't actually work in.
 *
 * `assertChannelsBelongToGuild` (channels.ts) only ever answered "does this channel exist in this guild" --
 * `GET /guilds/{id}/channels` isn't filtered by what the bot can see, so a private channel the bot was never
 * granted access to passes that check, shows up in the dashboard's channel picker, and only fails much later,
 * as a 403 in front of a user who has no idea why their ticket didn't open.
 *
 * Deliberately fails *open* on anything other than a definitive answer: this is a guard rail on someone else's
 * server configuration, not an authorization check, so a Discord hiccup must not be able to lock a guild
 * manager out of saving their config.
 */
export async function assertBotHasChannelPermissions(
	guildId: Snowflake,
	channelId: Snowflake,
	botId: BotId,
	required: bigint,
	logger: Logger,
): Promise<void> {
	const api = apiForGuild(botId, guildId);

	let permissions: bigint;
	try {
		// A bot user's id is its application id, which `getBotApplicationId` already caches per bot/instance.
		const botUserId = await getBotApplicationId(botId, guildId);
		const [guild, channel, botMember] = await Promise.all([
			api.guilds.get(guildId),
			api.channels.get(channelId),
			api.guilds.getMember(guildId, botUserId),
		]);

		permissions = computeChannelPermissions({
			guildId,
			guildOwnerId: guild.owner_id,
			memberId: botUserId,
			memberRoleIds: botMember.roles,
			overwrites: 'permission_overwrites' in channel ? (channel.permission_overwrites ?? []) : [],
			roles: guild.roles,
		});
	} catch (error) {
		// Discord refuses to describe a channel the bot can't see at all, so a 403 here is itself the answer
		// (and the exact case that motivated this check) rather than a reason to fail open.
		if (error instanceof DiscordAPIError && error.status === 403) {
			throw badRequest('the bot cannot access the provided modmail channel');
		}

		logger.warn({ err: error, guildId, channelId }, 'Failed to check the bot permissions for a channel, allowing');
		return;
	}

	const missing = required & ~permissions;
	if (missing) {
		throw badRequest(
			`the bot is missing the following permissions in channel ${channelId}: ${permissionNames(missing).join(', ')}`,
		);
	}
}
