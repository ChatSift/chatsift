import type { Logger } from '@chatsift/backend-core';
import { getContext, getSelfInstance } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { GuildSettings } from '@chatsift/db';
import type {
	APIGuildMember,
	APIMessageComponentInteraction,
	APIMessageStringSelectInteractionData,
} from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { findActiveBlock } from '../lib/blocks.js';
import { DmPendingOpenerStore, fetchDmCategories, finishDmTicket, sendDm } from '../lib/dmTicket.js';
import { countOpenDmThreadsForUser } from '../lib/threads.js';

/**
 * The other half of `lib/dmTicket.ts`'s opener flow -- fires once a user picks a category from the
 * select `handleDmMessage` posted into their DM. DM interactions carry no `guild_id`/`member` (only
 * `user` and `channel`), unlike a guild component interaction, so this resolves the guild from the
 * deployment's own self-instance rather than from the interaction itself -- correct because a DM-mode
 * deployment is locked to exactly one guild. No `stateStore` (see `DM_CATEGORY_SELECT_CUSTOM_ID`'s
 * comment): DM mode offers a guild's whole category list, not a panel-scoped subset, so nothing needs
 * to ride the custom_id.
 */
export default class DmCategorySelectComponent implements ComponentHandler {
	public readonly name = 'modmail-dm-category-select';

	public readonly stateStore = null;

	public async handle(interaction: APIMessageComponentInteraction, _state: never, logger: Logger): Promise<void> {
		await getContext().service.client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		const dmChannelId = interaction.channel?.id;
		if (!dmChannelId) {
			// Should never happen -- a component interaction always carries the channel its message is
			// in. No channel to delete-and-resend into, so this is the one case that still edits the
			// original interaction response in place.
			logger.warn('DM category select interaction is missing its channel');
			await getContext().service.client.api.interactions.editReply(interaction.application_id, interaction.token, {
				content: 'Something went wrong resolving this ticket request. Please DM the bot again to restart.',
				components: [],
			});
			return;
		}

		// Every outcome from here on deletes the select prompt instead of editing it in place -- leaving
		// it edited to arbitrary text reads as a leftover UI artifact sitting in the user's DMs forever,
		// unlike the panel flow's ephemeral equivalent (which visually disappears once its context is
		// done). Best-effort: a 404 (already gone) or a permissions hiccup shouldn't block anything else.
		const deletePrompt = async () => {
			try {
				await getContext().service.client.api.channels.deleteMessage(dmChannelId, interaction.message.id);
			} catch (error) {
				logger.warn({ err: error }, 'Failed to delete the DM category-select prompt');
			}
		};

		// Error/nudge outcomes still need to say something (there's nothing else that would tell the user
		// what happened) -- success deliberately does not call this at all (see the end of `handle`): the
		// ticket's own greeting, if any, is the only confirmation, and no synthetic fallback is sent when
		// there isn't one either.
		const finish = async (content: string) => {
			await deletePrompt();
			await sendDm(dmChannelId, content);
		};

		const guildId = getSelfInstance()?.guildId;
		const userId = interaction.user?.id;
		if (!guildId || !userId) {
			logger.warn({ guildId, userId }, 'DM category select is missing context it should always have');
			await finish('Something went wrong resolving this ticket request. Please DM the bot again to restart.');
			return;
		}

		// Bails out to a "start over" message on every failure branch below, clearing the pending record
		// each time -- unlike the panel flow's `categorySelect.ts`, the opener's select message here can't
		// be regenerated in place on failure (it was already posted, with fixed options, by `handleDmMessage`),
		// so a stale/invalid pick has no retry path except DMing the bot again from scratch.
		const bail = async (content: string) => {
			await DmPendingOpenerStore.delete(userId);
			await finish(content);
		};

		const pending = await DmPendingOpenerStore.get(userId);
		if (!pending) {
			await finish('This ticket request has expired. Please send a new message to start over.');
			return;
		}

		const data = interaction.data as APIMessageStringSelectInteractionData;
		const categoryId = Number(data.values[0]);

		// Re-validated against the live category list, same defensive re-check `categorySelect.ts` does
		// against its panel's list -- a category can be deleted between the opener and the pick.
		const categories = await fetchDmCategories(guildId);
		const category = categories.find((candidate) => candidate.id === categoryId);
		if (!category) {
			logger.warn({ categoryId, guildId }, 'DM category select picked an id no longer offered');
			await bail('That category is no longer available. Please DM the bot again to start a new ticket.');
			return;
		}

		const [guildSettings] = await getContext().db<GuildSettings[]>`
			SELECT * FROM guild_settings WHERE guild_id = ${guildId}
		`;

		if (!guildSettings?.modForumId) {
			await bail('ModMail is not fully configured in this server yet. Please let a moderator know.');
			return;
		}

		const block = await findActiveBlock(guildId, userId);
		if (block) {
			await bail(
				block.expiresAt
					? `You are blocked from opening ModMail tickets in this server until <t:${Math.floor(block.expiresAt.getTime() / 1_000)}:f>.`
					: 'You are blocked from opening ModMail tickets in this server.',
			);
			return;
		}

		// Guards the race between the opener and a pick landing up to `PENDING_TICKET_TTL_MS` later --
		// see `countOpenDmThreadsForUser`'s own doc comment.
		if ((await countOpenDmThreadsForUser(guildId, userId)) > 0) {
			await bail('You already have an open ticket in this server.');
			return;
		}

		let member: APIGuildMember;
		try {
			member = await getContext().service.client.api.guilds.getMember(guildId, userId);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 404) {
				await bail(
					'You need to be a member of this server to open a ticket. Please join first, then DM the bot again.',
				);
				return;
			}

			throw error;
		}

		let openerMessage;
		try {
			openerMessage = await getContext().service.client.api.channels.getMessage(dmChannelId, pending.openerMessageId);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 404) {
				await bail('Your original message could not be found. Please DM the bot again to start a new ticket.');
				return;
			}

			throw error;
		}

		await finishDmTicket({
			category,
			guildId,
			guildSettings,
			logger,
			member,
			openerMessage,
			user: interaction.user!,
			userChannelId: dmChannelId,
		});

		await DmPendingOpenerStore.delete(userId);
		await deletePrompt();
	}
}
