import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { SocialGuildSettings, SocialRewards } from '@chatsift/db';
import type { APIAllowedMentions } from '@discordjs/core';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { getGuildName, getRoleName } from './discordCache.js';
import { DEFAULT_LEVEL_UP_MESSAGE, templateLevelUpMessage } from './templateMessage.js';

/**
 * Level-up notifications (#343 P3), ported from legacy's `messageCreate` tail.
 *
 * Every send suppresses mentions entirely: the template only ever renders a plain username, a level, a guild name
 * and a list of role *names*, so there's nothing here that should ping -- and a guild-authored template must not
 * be able to turn a level-up into an `@everyone`.
 */
const NO_MENTIONS: APIAllowedMentions = { parse: [] };

/**
 * Formats the `{{ earnedRewards }}` placeholder, **including its leading space** -- the default message appends
 * it directly after the guild name (`...in {{ guildName }}{{ earnedRewards }}!`), so the spacing belongs to the
 * value. Legacy did the same.
 *
 * Roles that no longer exist in the guild are dropped rather than rendered as a dangling id.
 */
async function formatEarnedRewards(guildId: string, earned: readonly Pick<SocialRewards, 'roleId'>[]): Promise<string> {
	const resolved = await Promise.all(earned.map(async (reward) => getRoleName(guildId, reward.roleId)));
	const names = resolved.filter((name) => name !== undefined);

	return names.length > 0 ? ` and received: ${names.join(', ')}` : '';
}

export interface SendLevelUpNotificationOptions {
	/**
	 * The channel the level-up happened in -- the first choice for `CHANNEL` mode.
	 */
	channelId: string;
	/**
	 * Rewards newly earned by this level-up. With #343 P3's decision to announce the true new level rather than
	 * legacy's `oldLevel + 1`, this is every reward in `(oldLevel, newLevel]`, so a grant spanning two levels
	 * names both levels' rewards instead of silently dropping one.
	 */
	earnedRewards: readonly Pick<SocialRewards, 'roleId'>[];
	guildId: string;
	level: number;
	logger: Logger;
	settings: SocialGuildSettings;
	userId: string;
	username: string;
}

export async function sendLevelUpNotification({
	channelId,
	earnedRewards,
	guildId,
	level,
	logger,
	settings,
	userId,
	username,
}: SendLevelUpNotificationOptions): Promise<void> {
	if (settings.levelUpNotificationMode === 'NONE') {
		return;
	}

	const content = templateLevelUpMessage(settings.levelUpNotificationMessage ?? DEFAULT_LEVEL_UP_MESSAGE, {
		earnedRewards: await formatEarnedRewards(guildId, earnedRewards),
		guildName: (await getGuildName(guildId)) ?? 'this server',
		level: String(level),
		username,
	});

	const api = getContext().service.client.api;

	if (settings.levelUpNotificationMode === 'DM') {
		try {
			const dm = await api.users.createDM(userId);
			await api.channels.createMessage(dm.id, { content, allowed_mentions: NO_MENTIONS });
		} catch (error) {
			// Closed DMs are the overwhelmingly common case here and aren't worth escalating. Legacy had no
			// fallback for DM mode either -- a user who can't be DMed simply doesn't get told.
			logger.warn({ err: error, guildId, userId }, 'Failed to DM a level-up notification');
		}

		return;
	}

	try {
		await api.channels.createMessage(channelId, { content, allowed_mentions: NO_MENTIONS });
		return;
	} catch (error) {
		logger.warn(
			{ err: error, guildId, channelId },
			'Failed to send a level-up notification to the channel it happened in',
		);
	}

	if (!settings.levelUpNotificationFallbackChannelId) {
		return;
	}

	try {
		await api.channels.createMessage(settings.levelUpNotificationFallbackChannelId, {
			content,
			allowed_mentions: NO_MENTIONS,
		});
	} catch (error) {
		// A fallback channel that no longer exists is a dead setting, so it clears itself here -- ported legacy
		// behaviour that the API deliberately depends on: `updateConfig.ts` validates a *newly set* fallback but
		// never re-checks a stored one, precisely because the bot is what notices it going away.
		//
		// Only `UnknownChannel` qualifies. A permissions failure means the channel is real and someone can fix
		// it, and silently discarding their configuration over a transient 403 would be worse than not sending.
		if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownChannel) {
			logger.warn(
				{ guildId, fallbackChannelId: settings.levelUpNotificationFallbackChannelId },
				'Level-up fallback channel no longer exists; clearing it',
			);

			await getContext().db`
				UPDATE social_guild_settings
				SET level_up_notification_fallback_channel_id = NULL
				WHERE guild_id = ${guildId}
			`;

			return;
		}

		logger.warn(
			{ err: error, guildId, fallbackChannelId: settings.levelUpNotificationFallbackChannelId },
			'Failed to send a level-up notification to the fallback channel',
		);
	}
}
