import {
	appealAnswerInputs,
	appealDetailLink,
	appealEmbedInput,
	getAppealsSettings,
	getContext,
	listAppealAnswers,
	setAppealModMessage,
} from '@chatsift/backend-core';
import { buildAppealComponents, buildAppealEmbed, buildAppealThreadName, displayAvatarURL } from '@chatsift/core';
import type { AppealAnswers, Appeals } from '@chatsift/db';
import type { API, APIMessage } from '@discordjs/core';
import { ChannelType, RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
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
		const appellant = await resolveAppellant(api, appeal.userId);
		const body = buildCardBody(appeal, answers, appellant);

		const name = buildAppealThreadName(appealEmbedInput(appeal), appellant.appellantTag);

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
 * Rewrites that same card after a decision taken on the dashboard (#232 P5), so the two mod surfaces cannot
 * disagree about what was decided -- the twin of `services/appeals-bot`'s own `syncAppealCard`, and the same
 * arrangement `refreshCaseLog` already has with the bot's `dispatchCaseLog`.
 *
 * Edits only, never posts: a row with no `mod_message_id` is one the submit path could not post a card for, and
 * posting a decided appeal into the mod channel weeks later would announce as new something nobody can act on.
 *
 * **Never throws**, for the same reason as `postAppealCard`: the decision is committed by the time this runs, so
 * a card that failed to redraw is a stale message next to a correct database.
 */
export async function syncAppealCard(appeal: Appeals): Promise<void> {
	const context = getContext();

	// Where the message is, straight off the row -- not `appeals_settings.mod_channel_id`, which is where
	// appeals are posted *now* and can have moved since this one was.
	if (!appeal.modChannelId || !appeal.modMessageId) {
		return;
	}

	const api = apiForGuild('APPEALS', appeal.guildId);

	try {
		// Read back here rather than passed in by the route: the decision path has no reason to have loaded them,
		// and forgetting would silently redraw the card with no answers on it.
		const [answers, appellant] = await Promise.all([
			listAppealAnswers(appeal.id),
			resolveAppellant(api, appeal.userId),
		]);

		await api.channels.editMessage(appeal.modChannelId, appeal.modMessageId, buildCardBody(appeal, answers, appellant));
	} catch (error) {
		// `UnknownChannel` as well as `UnknownMessage`: deleting the whole mod channel is at least as likely as
		// deleting one card, and without this the row keeps pointing at a dead id forever. Forgetting the card is
		// the same self-heal the bot does.
		if (
			error instanceof DiscordAPIError &&
			(error.code === RESTJSONErrorCodes.UnknownMessage || error.code === RESTJSONErrorCodes.UnknownChannel)
		) {
			// Its own `try`, because this runs on the way *out* of a failure and the decision that called it is
			// already committed. A database hiccup here would otherwise break the "never throws" contract above and
			// hand a moderator an error for a decision that landed -- and their retry would then answer "somebody
			// else decided this first", which is a lie about what happened.
			try {
				await setAppealModMessage(appeal.id, null);
			} catch (cleanupError) {
				context.logger.warn(
					{ err: cleanupError, guildId: appeal.guildId, appealId: appeal.id },
					'could not forget a missing appeal card',
				);
				return;
			}

			context.logger.warn(
				{ guildId: appeal.guildId, appealId: appeal.id, code: error.code },
				'appeal card is gone, forgot it',
			);
			return;
		}

		context.logger.warn({ err: error, guildId: appeal.guildId, appealId: appeal.id }, 'failed to sync an appeal card');
	}
}

interface ResolvedAppellant {
	readonly appellantAvatarURL?: string;
	readonly appellantTag?: string;
}

/**
 * The one embed and its buttons, built the same way whether this is the first post or a redraw -- so a decided
 * card cannot end up missing something the fresh one had. Every piece of state on it comes from the row rather
 * than from the message being replaced, for the reason `syncReportCard` spells out: reading state back off the
 * UI you just rendered goes wrong the moment two moderators act at once.
 */
function buildCardBody(appeal: Appeals, answers: readonly AppealAnswers[], appellant: ResolvedAppellant) {
	const input = appealEmbedInput(appeal);

	return {
		embeds: [buildAppealEmbed(input, { answers: appealAnswerInputs(answers), ...appellant })],
		components: buildAppealComponents(input, { dashboardLink: appealDetailLink(appeal.guildId, appeal.id) }),
	};
}

/**
 * What to call the appellant on the card, and their avatar.
 *
 * Best-effort by construction: an appellant is banned from the guild in question and may have left every guild
 * this application can see, so this is the lookup in the product most likely to come back with nothing. A
 * failure renders the id alone rather than costing the guild the card.
 */
async function resolveAppellant(api: API, userId: string): Promise<ResolvedAppellant> {
	try {
		const user = await resolveDiscordUserOrNull(api, userId);
		if (!user) {
			return {};
		}

		return {
			appellantTag: user.global_name ?? user.username,
			...(user.avatar ? { appellantAvatarURL: displayAvatarURL(user.id, user.avatar) } : {}),
		};
	} catch (error) {
		getContext().logger.warn({ err: error, userId }, 'could not resolve an appellant for a card');
		return {};
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
