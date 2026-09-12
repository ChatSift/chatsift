import type { Logger } from '@chatsift/backend-core';
import {
	appealAnswerInputs,
	appealDetailLink,
	appealEmbedInput,
	getContext,
	listAppealAnswers,
	readAppealUserState,
	setAppealModMessage,
} from '@chatsift/backend-core';
import { fetchUser } from '@chatsift/bot-core';
import { buildAppealComponents, buildAppealEmbed, displayAvatarURL } from '@chatsift/core';
import type { Appeals } from '@chatsift/db';
import type { API } from '@discordjs/core';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';

/**
 * Rewrites the appeal's one embed (#232, decision 13) wherever `services/api` posted it.
 *
 * Edits only, never posts: the card is what a moderator clicked to get here, so a row with no
 * `mod_message_id` means the submit path could not post one, and this process has nothing to add by trying
 * again at decision time. Every state the card shows is derived from the row rather than from the components
 * on the interaction's own message, for the reason `syncReportCard` spells out -- reading state back off the
 * UI it just rendered goes wrong the moment two moderators click at once.
 *
 * **Never throws.** The decision is committed by the time this runs; a card that failed to redraw is a stale
 * message next to a correct database, which is the honest degradation.
 */
export async function syncAppealCard(appeal: Appeals, logger: Logger): Promise<void> {
	const api = getContext().service.client.api;

	try {
		// Where the message is, straight off the row -- not `appeals_settings.mod_channel_id`, which is where
		// appeals are posted *now* and can have moved since this one was.
		if (!appeal.modChannelId || !appeal.modMessageId) {
			logger.warn({ guildId: appeal.guildId, appealId: appeal.id }, 'appeal has no card to rewrite');
			return;
		}

		// Read back rather than threaded through from the caller: all three button handlers would otherwise have
		// to carry them, and forgetting would silently redraw the card with no answers on it.
		const [answers, appellant, dmReachable] = await Promise.all([
			listAppealAnswers(appeal.id),
			resolveAppellant(api, appeal.userId, logger),
			resolveDmReachable(appeal.userId, logger),
		]);

		const input = appealEmbedInput(appeal);

		await api.channels.editMessage(appeal.modChannelId, appeal.modMessageId, {
			embeds: [buildAppealEmbed(input, { answers: appealAnswerInputs(answers), dmReachable, ...appellant })],
			components: buildAppealComponents(input, { dashboardLink: appealDetailLink(appeal.guildId, appeal.id) }),
		});
	} catch (error) {
		// `UnknownChannel` as well as `UnknownMessage`: deleting the whole mod channel is at least as likely as
		// deleting one card, and without this the row keeps pointing at a dead id forever. Forgetting the card is
		// the same self-heal `syncReportCard` does.
		if (
			error instanceof DiscordAPIError &&
			(error.code === RESTJSONErrorCodes.UnknownMessage || error.code === RESTJSONErrorCodes.UnknownChannel)
		) {
			// Its own `try`, for the reason `services/api`'s twin spells out: this runs on the way *out* of a
			// failure, after the decision has committed, so a database hiccup here would break the "never throws"
			// contract above and report a landed decision as a failed one.
			try {
				await setAppealModMessage(appeal.id, null);
			} catch (cleanupError) {
				logger.warn(
					{ err: cleanupError, guildId: appeal.guildId, appealId: appeal.id },
					'could not forget a missing appeal card',
				);
				return;
			}

			logger.warn({ guildId: appeal.guildId, appealId: appeal.id, code: error.code }, 'appeal card is gone, forgot it');
			return;
		}

		logger.error({ err: error, guildId: appeal.guildId, appealId: appeal.id }, 'failed to sync an appeal card');
	}
}

/**
 * The one mod-facing bit of `appeal_user_state` (#232 P6), read at render time rather than passed in so a
 * redraw after a delivery picks up what that delivery proved.
 *
 * Guarded like `resolveAppellant` below, and for the stronger version of the same reason: this is a warning
 * line on a card, and an unguarded rejection inside the `Promise.all` above would cost the whole redraw --
 * leaving a decided appeal showing its three live buttons. A missing sentence is the cheaper failure.
 */
async function resolveDmReachable(userId: string, logger: Logger): Promise<boolean | null> {
	try {
		return (await readAppealUserState(userId))?.dmReachable ?? null;
	} catch (error) {
		logger.warn({ err: error, userId }, 'could not read an appellant delivery state for a card');
		return null;
	}
}

/**
 * What to call the appellant on the card, and their avatar.
 *
 * Best-effort by construction: an appellant is banned from the guild in question and may have left every guild
 * this bot can see, so this is the lookup in the product most likely to come back with nothing. A failure
 * renders the id alone rather than costing the guild the redraw.
 */
async function resolveAppellant(
	api: API,
	userId: string,
	logger: Logger,
): Promise<{ appellantAvatarURL?: string; appellantTag?: string }> {
	try {
		const user = await fetchUser(api, userId);
		if (!user) {
			return {};
		}

		return {
			appellantTag: user.global_name ?? user.username,
			...(user.avatar ? { appellantAvatarURL: displayAvatarURL(user.id, user.avatar) } : {}),
		};
	} catch (error) {
		logger.warn({ err: error, userId }, 'could not resolve an appellant for a card');
		return {};
	}
}
