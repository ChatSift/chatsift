import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { CommandHandler } from '@chatsift/bot-core';
import { collectModal } from '@chatsift/bot-core';
import { ChatInputCommandBuilder } from '@discordjs/builders';
import type {
	APIApplicationCommandInteraction,
	APIChatInputApplicationCommandInteraction,
	APIEmbed,
	APIModalSubmitGuildInteraction,
} from '@discordjs/core';
import {
	ApplicationIntegrationType,
	ComponentType,
	InteractionContextType,
	MessageFlags,
	RESTJSONErrorCodes,
	TextInputStyle,
} from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { ChatInputInteractionOptionResolver, ModalInteractionOptionResolver } from '@sapphire/discord-utilities';
import { nanoid } from 'nanoid';
import { buildForeignEmojiRejection, fetchGuildEmojiIds, findForeignEmojiTokens } from '../lib/emojis.js';
import { isMarkedDeleted, markFooterEdited, resolveEditedImage } from '../lib/replyModeration.js';
import { findOpenThreadByModThreadId, findStaffReplyByLocalId } from '../lib/threads.js';

/**
 * Only 404 / Unknown Message means "actually gone" -- anything else (missing permissions, rate limits,
 * transport errors) should surface as a real failure rather than being treated as a deleted reply.
 * Mirrors `services/ama-bot/src/components/amaRepostSelect.ts`'s existing use of this same check.
 */
function isUnknownMessageError(error: unknown): boolean {
	return error instanceof DiscordAPIError && (error.status === 404 || error.code === RESTJSONErrorCodes.UnknownMessage);
}

/**
 * Replaces an existing embed's text with newly-edited content, leaving `color`/`author` untouched.
 * `image` is re-derived via `resolveEditedImage` rather than carried over verbatim -- see its doc comment
 * for why resending the resolved CDN url as-is duplicates the image. Edit is deliberately text-only
 * otherwise: `thread_messages` stores no content or media metadata beyond the two Discord message ids, so
 * there's nothing to reconstruct an attachment/media note from -- whatever the embed already has there is
 * carried forward as-is.
 *
 * `markEdited` is only ever `true` for the mod-forum log copy -- the "edited" marker is internal
 * bookkeeping for staff, same as the `Reply ID:` prefix itself (`relay.ts`), and shouldn't leak onto the
 * copy the user who opened the ticket actually sees.
 */
function buildEditedEmbed(embed: APIEmbed, content: string, markEdited: boolean): APIEmbed {
	const image = resolveEditedImage(embed.image);
	return {
		...embed,
		description: content,
		...(image ? { image } : {}),
		...(markEdited && embed.footer ? { footer: markFooterEdited(embed.footer) } : {}),
	};
}

export default class EditCommand implements CommandHandler {
	public readonly name = 'edit';

	public readonly data = new ChatInputCommandBuilder()
		.setName('edit')
		.setDescription('Edit a past staff reply in this ModMail ticket by its Reply ID')
		.setContexts(InteractionContextType.Guild)
		.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
		.addIntegerOptions((option) =>
			option
				.setName('id')
				.setDescription('The Reply ID shown in this ticket’s mod-forum log message footer')
				.setRequired(true)
				.setMinValue(1),
		)
		.toJSON();

	public async handle(interaction: APIApplicationCommandInteraction, logger: Logger) {
		if (!interaction.guild_id || !interaction.channel || !interaction.member) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const thread = await findOpenThreadByModThreadId(interaction.channel.id);
		if (!thread) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This command can only be used inside an open ModMail ticket thread.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Extracted to a standalone `const` (rather than repeatedly reading `thread.userThreadId`) so
		// TypeScript's null-narrowing survives the `await`s below -- narrowing a plain object *property*
		// isn't guaranteed to persist across an intervening function call the way a narrowed local variable
		// is. An open thread with a staff reply already relayed into it should always have this set (see
		// `relay.ts`'s own guard on the same field), but it's still nullable in the schema, hence the check.
		const userThreadId = thread.userThreadId;
		if (!userThreadId) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This ticket has no active user thread to edit a reply in.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const options = new ChatInputInteractionOptionResolver(interaction as APIChatInputApplicationCommandInteraction);
		const replyId = options.getInteger('id', true);

		const row = await findStaffReplyByLocalId(thread.id, replyId);
		if (!row) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: `No staff reply with Reply ID #${replyId} was found in this ticket.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Best-effort pre-fill, fetched *before* the modal is shown since `createModal` has to happen
		// within Discord's 3-second interaction window with no `defer` available -- only this one extra
		// round-trip fits comfortably alongside the DB lookup above. The user-facing message's own
		// existence is deliberately not checked here (that would be a second round-trip); it's checked
		// after modal submit instead, once a `defer` is in place and time pressure is gone.
		let prefill = '';
		try {
			const logMessage = await getContext().service.client.api.channels.getMessage(
				thread.modThreadId,
				row.guildMessageId,
			);
			const embed = logMessage.embeds[0];
			if (embed && isMarkedDeleted(embed)) {
				await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
					content: `Reply #${replyId} was already deleted and can no longer be edited.`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			prefill = embed?.description ?? '';
		} catch (error) {
			logger.warn({ err: error, threadId: thread.id, replyId }, 'Failed to fetch log message for /edit pre-fill');
		}

		const id = nanoid();
		await getContext().service.client.api.interactions.createModal(interaction.id, interaction.token, {
			custom_id: id,
			title: `Edit reply #${replyId}`,
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							custom_id: 'content',
							type: ComponentType.TextInput,
							label: 'Message',
							style: TextInputStyle.Paragraph,
							min_length: 1,
							max_length: 4_000,
							required: true,
							...(prefill ? { value: prefill } : {}),
						},
					],
				},
			],
		});

		let modalInteraction: APIModalSubmitGuildInteraction;
		try {
			modalInteraction = (await collectModal(id, 5 * 60 * 1_000)) as APIModalSubmitGuildInteraction;
		} catch {
			// Timing out is a routine outcome (staff opened the modal and never submitted it), not a bug --
			// letting the rejection propagate would crash the whole bot, same reasoning as `reply.ts`.
			await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
				content: "⌛ You didn't submit that in time. Run `/edit` again when you're ready.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await getContext().service.client.api.interactions.defer(modalInteraction.id, modalInteraction.token, {
			flags: MessageFlags.Ephemeral,
		});

		const modalOptions = new ModalInteractionOptionResolver(modalInteraction);
		const content = modalOptions.getTextInput('content');

		const guildEmojiIds = await fetchGuildEmojiIds(modalInteraction.guild_id, getContext().service.client.api, logger);
		if (!guildEmojiIds) {
			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{
					content: "⚠️ Couldn't verify this server's emotes right now. Please try `/edit` again in a moment.",
				},
			);
			return;
		}

		const foreignEmojiTokens = findForeignEmojiTokens(content, guildEmojiIds);
		if (foreignEmojiTokens.length > 0) {
			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				buildForeignEmojiRejection(foreignEmojiTokens, content),
			);
			return;
		}

		try {
			const userMessage = await getContext().service.client.api.channels.getMessage(userThreadId, row.userMessageId);

			const logMessage = await getContext().service.client.api.channels.getMessage(
				thread.modThreadId,
				row.guildMessageId,
			);

			const logEmbed = logMessage.embeds[0];
			const userEmbed = userMessage.embeds[0];
			if (!logEmbed || !userEmbed) {
				throw new Error(`Reply ${replyId} in thread ${thread.id} is missing an embed on one of its two messages`);
			}

			if (isMarkedDeleted(logEmbed)) {
				await getContext().service.client.api.interactions.editReply(
					modalInteraction.application_id,
					modalInteraction.token,
					{ content: `Reply #${replyId} was deleted and can no longer be edited.` },
				);
				return;
			}

			await Promise.all([
				getContext().service.client.api.channels.editMessage(thread.modThreadId, row.guildMessageId, {
					embeds: [buildEditedEmbed(logEmbed, content, true)],
				}),
				getContext().service.client.api.channels.editMessage(userThreadId, row.userMessageId, {
					embeds: [buildEditedEmbed(userEmbed, content, false)],
				}),
			]);

			logger.info({ threadId: thread.id, replyId }, 'Edited staff reply');
			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{ content: `✅ Reply #${replyId} updated.` },
			);
		} catch (error) {
			if (isUnknownMessageError(error)) {
				await getContext().service.client.api.interactions.editReply(
					modalInteraction.application_id,
					modalInteraction.token,
					{ content: `❌ Reply #${replyId} was deleted and can no longer be edited.` },
				);
				return;
			}

			logger.error({ err: error, threadId: thread.id, replyId }, 'Failed to edit staff reply');
			await getContext().service.client.api.interactions.editReply(
				modalInteraction.application_id,
				modalInteraction.token,
				{ content: '❌ Failed to edit that reply. Please try again or reach out for support.' },
			);
		}
	}
}
