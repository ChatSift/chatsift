import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { ComponentHandler } from '@chatsift/bot-core';
import type { Categories, GuildSettings } from '@chatsift/db';
import type { APIMessageComponentInteraction, APIMessageStringSelectInteractionData } from '@discordjs/core';
import { MessageFlags } from '@discordjs/core';
import { CategorySelectStore, type CategorySelectState } from '../lib/categoryState.js';
import { withGuildUserLock } from '../lib/guildUserQueue.js';
import { clearPendingTicketRecord } from '../lib/pendingTicket.js';
import { relayUserMessageToModThread } from '../lib/relay.js';
import { countOpenThreadsForUserInCategory } from '../lib/threads.js';
import { finishTicketCreation, sendGreeting } from '../lib/ticketCreation.js';

export default class CategorySelectComponent implements ComponentHandler<CategorySelectState> {
	public readonly name = 'modmail-category-select';

	public readonly stateStore = CategorySelectStore;

	public async handle(
		interaction: APIMessageComponentInteraction,
		state: CategorySelectState,
		logger: Logger,
	): Promise<void> {
		const guildId = interaction.guild_id;
		const member = interaction.member;
		if (!guildId || !member) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'This can only be used in a server.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const user = member.user;
		const data = interaction.data as APIMessageStringSelectInteractionData;
		const categoryId = Number(data.values[0]);

		if (!state.categoryIds.includes(categoryId)) {
			logger.warn({ categoryId, guildId }, 'Category select picked an id outside the stored allow-list');
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'That category is no longer available. Please contact a moderator.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const [category] = await getContext().db<Categories[]>`
			SELECT * FROM categories WHERE id = ${categoryId} AND guild_id = ${guildId}
		`;

		if (!category) {
			logger.warn({ categoryId, guildId }, 'Selected category no longer exists');
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'That category no longer exists. Please contact a moderator.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const [guildSettings] = await getContext().db<GuildSettings[]>`
			SELECT * FROM guild_settings WHERE guild_id = ${guildId}
		`;

		if (!guildSettings?.modForumId) {
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: 'ModMail is not fully configured in this server yet. Please let a moderator know.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Captured before the closure below — narrowing from the `!guildSettings?.modForumId` guard
		// above doesn't flow into a nested function, so TypeScript would otherwise still see
		// `string | null` inside it.
		const modForumId = guildSettings.modForumId;

		// `category.maxConcurrentThreads` is nullable ("inherit the guild's general limit") and is
		// clamped to the guild's current value regardless — the write-side routes validate a category
		// override never exceeds the guild setting at the time it's set, but the guild setting can be
		// lowered afterwards without touching existing categories, so this stays the source of truth for
		// what the limit actually is right now.
		const categoryMax =
			category.maxConcurrentThreads === null
				? guildSettings.maxConcurrentThreads
				: Math.min(category.maxConcurrentThreads, guildSettings.maxConcurrentThreads);

		// Captured for the same reason as `modForumId` above — `category`'s narrowing from the `!category`
		// guard doesn't flow into `limitMessage`'s nested function body.
		const categoryName = category.name;

		function limitMessage(openCount: number): string {
			return openCount === 1 && categoryMax === 1
				? `You already have an open ticket in the "${categoryName}" category. Close it before opening another there.`
				: `You already have ${openCount} open ticket(s) in the "${categoryName}" category (limit: ${categoryMax}). Close one before opening another there.`;
		}

		// Optimistic check, purely for fast feedback — not under the lock yet, so a second ticket
		// resolving its own category pick concurrently (a different private thread, same user) isn't
		// serialized against this one here. The authoritative recheck happens below, inside
		// `withGuildUserLock`, immediately before `finishTicketCreation` actually claims the slot.
		const openInCategory = await countOpenThreadsForUserInCategory(guildId, user.id, category.id);
		if (openInCategory >= categoryMax) {
			// Not deferred yet, so this `reply` (rather than an edit) leaves the select menu itself
			// intact and interactive — same pattern as the "category no longer available"/"no longer
			// exists" checks above, letting the user immediately retry with a different category instead
			// of the setup dead-ending here.
			await getContext().service.client.api.interactions.reply(interaction.id, interaction.token, {
				content: limitMessage(openInCategory),
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Deferred here, before the slow part (mod-forum thread creation, the relay's media re-upload,
		// the greeting) — all of that easily outlasts Discord's 3-second component-ack window, and the
		// self-destruct deleteMessage call below needs the interaction to still be alive when it runs.
		await getContext().service.client.api.interactions.deferMessageUpdate(interaction.id, interaction.token);

		await withGuildUserLock(guildId, user.id, async () => {
			let succeeded = false;
			try {
				// Authoritative recheck, now serialized against every other ticket-lifecycle event for this
				// guild+user by the lock — the pre-lock check above only gives fast feedback and can't stop
				// two picks for the same category (two different private threads) both slipping under the
				// limit if they raced each other into this handler.
				const openInCategoryLocked = await countOpenThreadsForUserInCategory(guildId, user.id, category.id);
				if (openInCategoryLocked >= categoryMax) {
					await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
						content: limitMessage(openInCategoryLocked),
						flags: MessageFlags.Ephemeral,
					});
					return;
				}

				const thread = await finishTicketCreation({
					alertRoleId: guildSettings.alertRoleId,
					category,
					createdById: user.id,
					guildId,
					logger,
					member,
					modForumId,
					privateThreadId: interaction.channel.id,
					user,
				});

				// The category prompt only fires after the user's first message (see `index.ts`), so that
				// message is stashed in `state` and relayed now — both the category and the message reach
				// staff together instead of an empty ticket showing up first. There's no thread history yet
				// to resolve a specific "replying to #N" for (see index.ts's `handleFirstMessage`), so a reply
				// only ever gets the generic note here.
				const contextNote = state.isForwarded
					? '📨 *Forwarded message*'
					: state.isReply
						? '↩️ *replying to an earlier message*'
						: undefined;

				const relayOpener = async () =>
					relayUserMessageToModThread({
						attachments: state.attachments.map((attachment) => ({
							url: attachment.url,
							filename: attachment.filename,
							content_type: attachment.contentType || undefined,
							size: attachment.size,
						})),
						contextNote,
						content: state.content,
						logger,
						member,
						messageId: state.messageId,
						stickers: state.stickers.map((sticker) => ({
							id: sticker.id,
							name: sticker.name,
							format_type: sticker.formatType,
						})),
						thread,
						user,
					});

				const greetUser = async () =>
					sendGreeting({
						category,
						defaultGreetingMessage: guildSettings.defaultGreetingMessage,
						guildId,
						member,
						modThreadId: thread.modThreadId,
						privateThreadId: interaction.channel.id,
						user,
					});

				if (guildSettings.greetingBeforeOpener) {
					await greetUser();
					await relayOpener();
				} else {
					await relayOpener();
					await greetUser();
				}

				succeeded = true;
			} catch (error) {
				// Without this, a failure here would propagate straight out of `withGuildUserLock` and
				// skip both the state cleanup below and the self-destruct — leaving the category select
				// stuck on-screen forever with no feedback, since `deferMessageUpdate` above already
				// consumed the interaction's only implicit acknowledgement.
				logger.error({ err: error, guildId, userId: user.id }, 'Failed to finish ticket creation from category select');
				await getContext().service.client.api.interactions.followUp(interaction.application_id, interaction.token, {
					content: '❌ Something went wrong finishing your ticket. Please contact a moderator.',
					flags: MessageFlags.Ephemeral,
				});
			} finally {
				// Only cleared on success (a real `threads` row now exists to block re-creation). Left in
				// place on the limit-rejection and error paths -- the private thread that's still sitting
				// there unresolved should keep counting against `countActiveTicketsForUser` until it's
				// either abandoned (the durable row is what `lib/pendingTicketSweep.ts` polls to find and
				// delete it) or a moderator sorts the user out directly. Clearing it here unconditionally
				// would both let the count silently drop and orphan the private thread from the sweep.
				if (succeeded) {
					await clearPendingTicketRecord(interaction.channel.id);
				}
			}

			const stateId = data.custom_id.split(':')[1];
			if (stateId) {
				await CategorySelectStore.delete(stateId);
			}

			// Self-destruct rather than leaving a "Category selected: X" message behind — the category
			// pick was just a one-time fork in the setup flow, not something worth a permanent trace once
			// the actual ticket (with the user's message already relayed above) exists.
			await getContext().service.client.api.channels.deleteMessage(interaction.channel.id, interaction.message.id);
		});
	}
}
