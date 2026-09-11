import {
	appealAnswerInputs,
	appealDetailLink,
	appealEmbedInput,
	getAppealsSettings,
	getContext,
	setAppealModMessage,
} from '@chatsift/backend-core';
import { buildAppealComponents, buildAppealEmbed, buildAppealThreadName, displayAvatarURL } from '@chatsift/core';
import type { AppealAnswers, Appeals } from '@chatsift/db';
import type { API, APIMessage } from '@discordjs/core';
import { ChannelType } from '@discordjs/core';
import { fetchGuildChannels } from './channels.js';
import { apiForGuild } from './discordAPI.js';
import { resolveDiscordUserOrNull } from './users.js';

/**
 * Puts a freshly filed appeal in front of the guild's moderators (#232 P4).
 *
 * `services/appeals-bot` rewrites this same message on every decision, and the two share the builders in
 * `@chatsift/core` rather than either owning the card -- the same arrangement `postReportCard` already has
 * with the bot's `syncReportCard`. The buttons carry the bot's custom-id prefixes and it handles them whichever
 * process posted the message, because it is the same application either way.
 *
 * **Never throws.** The appeal row is committed by the time this runs and the appellant has already been told
 * their appeal went through, because it did. A card that failed to post is a degraded surface -- P5's dashboard
 * queue reads the row regardless -- rather than lost work.
 */
export async function postAppealCard(appeal: Appeals, answers: readonly AppealAnswers[]): Promise<void> {
	const context = getContext();

	try {
		const settings = await getAppealsSettings(appeal.guildId);
		if (!settings) {
			return;
		}

		const api = apiForGuild('APPEALS', appeal.guildId);
		const user = await resolveDiscordUserOrNull(api, appeal.userId);
		const appellantTag = user ? (user.global_name ?? user.username) : undefined;

		const input = appealEmbedInput(appeal);
		const body = {
			embeds: [
				buildAppealEmbed(input, {
					answers: appealAnswerInputs(answers),
					...(appellantTag ? { appellantTag } : {}),
					...(user?.avatar ? { appellantAvatarURL: displayAvatarURL(user.id, user.avatar) } : {}),
				}),
			],
			components: buildAppealComponents(input, { dashboardLink: appealDetailLink(appeal.guildId, appeal.id) }),
		};

		const name = buildAppealThreadName(input, appellantTag);

		// A forum channel gets one post per appeal, a text channel one message with a thread opened on it
		// immediately (decision 13). Both end with exactly one embed and somewhere to discuss it; which one this
		// guild has is a property of the channel it picked, so it is read rather than stored -- `updateConfig`
		// already refuses anything that is neither.
		const channelType = await resolveModChannelType(appeal.guildId, settings.modChannelId);

		let card: { channelId: string; messageId: string; threadId: string | null };

		if (channelType === ChannelType.GuildForum) {
			const thread = await api.channels.createForumThread(settings.modChannelId, { name, message: body });
			// A forum post's starter message carries the same id as the thread itself, and it lives *in* the post
			// rather than in the forum -- so both ids here are the thread's. (The response does carry a `message`
			// object, but `APIThreadChannel` does not type it.)
			card = { channelId: thread.id, messageId: thread.id, threadId: thread.id };
		} else {
			const posted: APIMessage = await api.channels.createMessage(settings.modChannelId, body);

			// The thread is a place for moderators to talk about the appeal, and it is opened now rather than on
			// first use because nothing later in the appeal's life has a reason to create one.
			card = {
				channelId: settings.modChannelId,
				messageId: posted.id,
				threadId: await openThread(api, settings.modChannelId, posted.id, name),
			};
		}

		await setAppealModMessage(appeal.id, card);
	} catch (error) {
		context.logger.warn({ err: error, guildId: appeal.guildId, appealId: appeal.id }, 'failed to post an appeal card');
	}
}

/**
 * `null` when the thread could not be created, which leaves a perfectly usable card: the embed and its buttons
 * are the product, and a guild that revoked Create Public Threads after configuring Appeals should still get
 * the appeal rather than losing it to a permission it does not need for the decision itself.
 */
async function openThread(api: API, channelId: string, messageId: string, name: string): Promise<string | null> {
	try {
		const thread = await api.channels.createThread(channelId, { name }, messageId);
		return thread.id;
	} catch (error) {
		getContext().logger.warn({ err: error, channelId, messageId }, 'could not open a thread on an appeal card');
		return null;
	}
}

/**
 * Read from the guild's channel list rather than fetched by id, so it comes out of the same cache the config
 * screen already fills. An unresolvable channel falls back to the text-channel path: that is the shape
 * `createMessage` handles, and its failure is then the honest one ("the bot cannot post there") instead of a
 * forum call against a text channel.
 */
async function resolveModChannelType(guildId: string, channelId: string): Promise<ChannelType> {
	const channels = await fetchGuildChannels(guildId, 'APPEALS');
	return channels?.find((channel) => channel.id === channelId)?.type ?? ChannelType.GuildText;
}
