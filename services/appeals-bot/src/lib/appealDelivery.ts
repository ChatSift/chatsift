import type { AppealDeliveryDiscord, Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { APPEAL_REJOIN_INVITE_MAX_AGE_SECONDS, APPEAL_REJOIN_INVITE_MAX_USES } from '@chatsift/core';
import { ChannelType, RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';

/**
 * The Discord half of P6's delivery, for decisions taken on the card's buttons (#232 P6).
 *
 * The twin of `services/api`'s `util/appealDelivery.ts`, and the same arrangement `syncAppealCard` already has
 * with its own twin there: the sequencing, decision 14's three-sided consent and everything written down
 * afterwards live once in `@chatsift/backend-core`'s `deliverAppealDecision`, and each surface supplies the
 * four calls it cannot make -- that package has no `@discordjs/rest` dependency, which is the same reason
 * `applyAppealDecision` takes its unban as a callback. **What reaches the appellant must not depend on which
 * surface decided**; the only thing the two twins may differ on is how each process happens to reach Discord.
 */
export function botAppealDelivery(logger: Logger): AppealDeliveryDiscord {
	return {
		async guildName(guildId) {
			// Fetched rather than read off a cache: this process has no guild-object cache of its own (`bot-core`
			// caches channels and users, and the guild *list* is ids only), and one `GET /guilds/{id}` per
			// decision is not a volume worth building one for.
			const guild = await getContext().service.client.api.guilds.get(guildId);
			return guild.name;
		},

		async addMember(guildId, userId, accessToken) {
			await getContext().service.client.api.guilds.addMember(guildId, userId, { access_token: accessToken });
		},

		async createInvite(guildId) {
			return createRejoinInvite(guildId, logger);
		},

		async sendDirectMessage(userId, content) {
			// The Appeals *bot* token, not the appellant's OAuth one: the user install they granted on `unban.app`
			// is what lets this application DM somebody it shares no guild with (§6), and the OAuth grant only
			// ever buys `guilds.join`.
			return sendDirectMessage(userId, content);
		},
	};
}

/**
 * How many channels are worth trying before giving up and DMing the decision without a way back in.
 *
 * Bounded because an appellant does not need the prettiest landing spot, they need one door that opens --
 * and walking a thousand-channel guild looking for a better one is how a decision delivery becomes a rate
 * limit on the surface that just approved it.
 */
const INVITE_CANDIDATE_LIMIT = 5;

/**
 * Mints the way back in, or `null` when Appeals cannot make one anywhere in the guild.
 *
 * `null` is an ordinary answer rather than a failure: `CREATE_INSTANT_INVITE` is not a permission the Appeals
 * setup asks for, so a guild that never granted it lands here every time and the DM says only that the ban is
 * lifted. Rules and system channels lead the list because a guild that set either has already nominated where
 * an arriving member should land.
 */
async function createRejoinInvite(guildId: string, logger: Logger): Promise<string | null> {
	const api = getContext().service.client.api;
	const candidates: string[] = [];

	try {
		const guild = await api.guilds.get(guildId);
		candidates.push(guild.rules_channel_id ?? '', guild.system_channel_id ?? '');
	} catch (error) {
		logger.warn({ err: error, guildId }, 'could not read a guild while picking an invite channel');
	}

	try {
		for (const channel of await api.guilds.getChannels(guildId)) {
			if (channel.type === ChannelType.GuildText) {
				candidates.push(channel.id);
			}
		}
	} catch (error) {
		logger.warn({ err: error, guildId }, 'could not list channels while picking an invite channel');
	}

	for (const channelId of [...new Set(candidates.filter(Boolean))].slice(0, INVITE_CANDIDATE_LIMIT)) {
		try {
			const invite = await api.channels.createInvite(
				channelId,
				{
					max_age: APPEAL_REJOIN_INVITE_MAX_AGE_SECONDS,
					max_uses: APPEAL_REJOIN_INVITE_MAX_USES,
					// A fresh code rather than a reused one, so the single-use cap is this appellant's alone and
					// revoking their way back in never revokes anybody else's.
					unique: true,
				},
				{ reason: 'Appeal approved' },
			);

			return `https://discord.gg/${invite.code}`;
		} catch (error) {
			logger.info({ err: error, guildId, channelId }, 'could not create a rejoin invite here');
		}
	}

	return null;
}

/**
 * Sends the DM, treating Discord's refusal as an outcome rather than an error.
 *
 * Both of the 50007-family codes count: the plain one is closed DMs or a block, and the mutual-guilds one is
 * the appellant having removed the user install since they authorized -- which is the likeliest way for this to
 * fail, given they are banned from the only guild they would otherwise share with us.
 */
async function sendDirectMessage(userId: string, content: string): Promise<'blocked' | 'sent'> {
	const api = getContext().service.client.api;

	try {
		const channel = await api.users.createDM(userId);
		await api.channels.createMessage(channel.id, { content });
		return 'sent';
	} catch (error) {
		if (
			error instanceof DiscordAPIError &&
			(error.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser ||
				error.code === RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds)
		) {
			return 'blocked';
		}

		throw error;
	}
}
