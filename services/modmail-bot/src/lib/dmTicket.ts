import type { Logger } from '@chatsift/backend-core';
import { getContext, getSelfInstance, RedisStore } from '@chatsift/backend-core';
import type { Categories, GuildSettings, Threads } from '@chatsift/db';
import type { APIGuildMember, APIMessage, APIUser, GatewayMessageCreateDispatchData } from '@discordjs/core';
import { ComponentType } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { createRecipe, DataType } from 'bin-rw';
import { findActiveBlock } from './blocks.js';
import { buildCategorySelectOptions } from './categorySelectOptions.js';
import { withGuildUserLock } from './guildUserQueue.js';
import type { MessageLike } from './messageContext.js';
import { buildContextNote, resolveEffectiveContent, resolveReplyReferenceId } from './messageContext.js';
import { PENDING_TICKET_TTL_MS } from './pendingTicket.js';
import { relayUserMessageToModThread } from './relay.js';
import { findOpenThreadsForUser } from './threads.js';
import { finishTicketCreation, sendGreeting } from './ticketCreation.js';

/**
 * No panel/state to encode -- DM mode offers a guild's whole category list (decision 7), not a
 * panel-scoped subset, so the string select's own `values[0]` is enough to resolve a pick, the same
 * way `custom_id` needs no suffix for a component with `stateStore: null`.
 */
export const DM_CATEGORY_SELECT_CUSTOM_ID = 'modmail-dm-category-select';

/**
 * How long a blocked user's "you are blocked" notice is claimed for -- see the cooldown claim in
 * `handleDmMessage`. Matches `lib/replyAlerts.ts`'s debounce window in shape (an atomic `SET ... NX`
 * claim, same pattern), chosen independently: this one exists to bound API cost under intentional spam,
 * not just UX noise, so it can be generous without meaningfully delaying a legitimate one-time notice.
 */
const BLOCKED_NOTICE_COOLDOWN_MS = 5 * 60 * 1_000;

function blockedNoticeCooldownKey(guildId: string, userId: string): string {
	return `modmail:dm-blocked-notice-cooldown:${guildId}:${userId}`;
}

export interface DmPendingOpener {
	guildId: string;
	openerMessageId: string;
}

/**
 * Bridges a DM opener to its (possibly much later, up to `PENDING_TICKET_TTL_MS`) category pick --
 * `components/dmCategorySelect.ts` re-fetches the opener message by id from this rather than trying to
 * serialize its full content into Redis, same reasoning as `PendingTicketStore` in `lib/pendingTicket.ts`
 * (whose TTL this reuses). No durable-table counterpart is needed the way `pending_tickets` backs that
 * store: there's no private-thread channel for `lib/pendingTicketSweep.ts` to clean up on timeout, a DM
 * channel just sits there unless the user comes back to it. See docs/roadmap/08-modmail-custom-instances.md.
 */
export const DmPendingOpenerStore = new RedisStore<DmPendingOpener>({
	TTL: PENDING_TICKET_TTL_MS,
	recipe: createRecipe({
		guildId: DataType.String,
		openerMessageId: DataType.String,
	}),
	makeKey: (userId: string) => `modmail:dm-pending-opener:${userId}`,
	storeOld: false,
});

/**
 * All of a guild's categories, ordered the same way the panel flow's picker is -- DM mode has no
 * concept of a panel to scope categories to (decision 7 in the roadmap doc: panels and
 * `ticket_panel_categories` are dead config while DM mode is on). Exported for `dmCategorySelect.ts`'s
 * own re-validation of a pick against the live list.
 */
export async function fetchDmCategories(guildId: string): Promise<Categories[]> {
	return getContext().db<Categories[]>`
		SELECT * FROM categories WHERE guild_id = ${guildId} ORDER BY sort_order, id
	`;
}

type DmOpenerMessage = MessageLike & Pick<APIMessage, 'id'>;

export interface FinishDmTicketOptions {
	category: Categories | null;
	guildId: string;
	guildSettings: GuildSettings;
	logger: Logger;
	member: APIGuildMember;
	openerMessage: DmOpenerMessage;
	user: APIUser;
	userChannelId: string;
}

/**
 * Shared by both DM-opener paths -- the no-category case (`handleDmMessage` below, straight through)
 * and the category-pick case (`components/dmCategorySelect.ts`, once a pick resolves). Mirrors
 * `index.ts#handleFirstMessage`'s create-thread/relay-opener/greet sequence, except the relay/greeting
 * order is never conditional here: DM mode always greets *after* the relay (decision 6 in the roadmap
 * doc), ignoring `guildSettings.greetingBeforeOpener` entirely rather than branching on it.
 */
export async function finishDmTicket({
	category,
	guildId,
	guildSettings,
	logger,
	member,
	openerMessage,
	user,
	userChannelId,
}: FinishDmTicketOptions): Promise<Threads> {
	const thread = await finishTicketCreation({
		alertRoleId: guildSettings.alertRoleId,
		category,
		createdById: user.id,
		guildId,
		logger,
		member,
		// Callers only reach this function once `guildSettings.modForumId` has already been checked
		// non-null (see `handleDmMessage`/`dmCategorySelect.ts`) -- narrowed here rather than widening
		// `finishTicketCreation`'s own required `modForumId: string` to accept `null`.
		modForumId: guildSettings.modForumId!,
		origin: 'dm',
		user,
		userChannelId,
	});

	const effective = resolveEffectiveContent(openerMessage);
	await relayUserMessageToModThread({
		attachments: effective.attachments,
		contextNote: await buildContextNote(openerMessage, effective.isForwarded, thread, logger),
		content: effective.content,
		isForwarded: effective.isForwarded,
		logger,
		member,
		messageId: openerMessage.id,
		repliedToMessageId: resolveReplyReferenceId(openerMessage),
		stickers: effective.stickers,
		thread,
		user,
	});

	// Always after the relay above -- DM mode ignores `guildSettings.greetingBeforeOpener` (decision 6).
	await sendGreeting({
		category,
		defaultGreetingMessage: guildSettings.defaultGreetingMessage,
		guildId,
		member,
		modThreadId: thread.modThreadId,
		threadId: thread.id,
		user,
		userChannelId,
	});

	return thread;
}

/**
 * Exported for `components/dmCategorySelect.ts` too -- every outcome message in the DM opener flow
 * (nudges, rejections, the post-pick confirmation) is a plain new message, never an edited-in-place
 * interaction response, so the flow reads as a normal conversation rather than a picker UI mutating
 * into arbitrary text.
 */
export async function sendDm(channelId: string, content: string): Promise<void> {
	await getContext().service.client.api.channels.createMessage(channelId, { content });
}

/**
 * Called from `index.ts`'s `registerMessageRelay` only once a DM message matched no open ticket, no
 * open mod-forum thread, and no pending panel ticket -- i.e. every case DM mode actually needs to
 * handle itself: a fresh opener, or a message sent while a category pick is still pending.
 */
export async function handleDmMessage(message: GatewayMessageCreateDispatchData, logger: Logger): Promise<void> {
	// DM mode is only meaningful for a deployment locked to one guild -- the public bot (many guilds,
	// no single guild a bare DM could belong to) always ignores DMs.
	const selfInstance = getSelfInstance();
	if (!selfInstance) {
		return;
	}

	const guildId = selfInstance.guildId;
	const [guildSettings] = await getContext().db<GuildSettings[]>`
		SELECT * FROM guild_settings WHERE guild_id = ${guildId}
	`;

	if (!guildSettings?.dmMode) {
		return;
	}

	const userId = message.author.id;
	const dmChannelId = message.channel_id;

	// Same per guild+user lock every other ticket-lifecycle step uses (see `lib/guildUserQueue.ts`) --
	// serializes a burst of DMs the same way a burst of panel clicks is serialized.
	await withGuildUserLock(guildId, userId, async () => {
		if (!guildSettings.modForumId) {
			logger.warn({ guildId }, 'DM mode is on but ModMail is not fully configured');
			await sendDm(dmChannelId, 'ModMail is not fully configured in this server yet. Please let a moderator know.');
			return;
		}

		// A user with an already-open *panel*-origin ticket (from before DM mode was turned on, or from
		// a higher `max_concurrent_threads` a panel allowed) must not get a second, parallel ticket opened
		// via DM -- redirect them to the existing one(s) instead. A DM-origin open ticket can never reach
		// this point at all: it would already have matched `findOpenThreadByUserChannelId` in
		// `registerMessageRelay` and been relayed there, before `handleDmMessage` is ever called (see
		// `findOpenThreadsForUser`'s own doc comment).
		const openThreads = await findOpenThreadsForUser(guildId, userId);
		if (openThreads.length > 0) {
			const links = openThreads.map((openThread) => `<#${openThread.userChannelId}>`).join(', ');
			await sendDm(
				dmChannelId,
				openThreads.length === 1
					? `You already have an open ticket in this server: ${links}. Please continue the conversation there.`
					: `You already have open tickets in this server: ${links}. Please continue the conversation in one of those.`,
			);
			return;
		}

		// A pending category pick already exists for this user -- this message is a nudge target, not a
		// new opener (decision 8: not relayed while a pick is outstanding).
		if (await DmPendingOpenerStore.get(userId)) {
			await sendDm(dmChannelId, 'Please pick a category above to open your ticket.');
			return;
		}

		// Checked *before* the member fetch below (unlike the panel flow, where a block is only ever
		// reached after a button click already spent Discord's own interaction-rate friction) -- a DM has
		// no such friction, a blocked user can just mash send. `findActiveBlock` itself is a cheap local
		// query either way, but the response to it is the abuse surface: without the cooldown claim, every
		// spammed message would otherwise cost a fresh `guilds.getMember` *and* a fresh reply, both real
		// Discord API calls. Once claimed, every message in the window short-circuits here with nothing
		// but this one DB query and a Redis `SET NX` -- no Discord API call of any kind.
		const block = await findActiveBlock(guildId, userId);
		if (block) {
			const claimed = await getContext().redis.set(blockedNoticeCooldownKey(guildId, userId), '1', {
				condition: 'NX',
				expiration: { type: 'PX', value: BLOCKED_NOTICE_COOLDOWN_MS },
			});

			if (claimed === null) {
				return;
			}

			await sendDm(
				dmChannelId,
				block.expiresAt
					? `You are blocked from opening ModMail tickets in this server until <t:${Math.floor(block.expiresAt.getTime() / 1_000)}:f>.`
					: 'You are blocked from opening ModMail tickets in this server.',
			);
			return;
		}

		let member: APIGuildMember;
		try {
			member = await getContext().service.client.api.guilds.getMember(guildId, userId);
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 404) {
				await sendDm(dmChannelId, 'You need to be a member of this server to open a ticket. Please join first.');
				return;
			}

			throw error;
		}

		const categories = await fetchDmCategories(guildId);

		if (categories.length === 0) {
			try {
				await finishDmTicket({
					category: null,
					guildId,
					guildSettings,
					logger,
					member,
					openerMessage: message,
					user: message.author,
					userChannelId: dmChannelId,
				});
			} catch (error) {
				logger.error({ err: error, guildId, userId }, 'Failed to finish DM ticket creation');
				await sendDm(
					dmChannelId,
					'❌ Something went wrong setting up your ticket. Please try sending your message again, or contact a moderator.',
				);
			}

			return;
		}

		await DmPendingOpenerStore.set(userId, { guildId, openerMessageId: message.id });

		await getContext().service.client.api.channels.createMessage(dmChannelId, {
			content: 'Please pick a category for your ticket:',
			components: [
				{
					type: ComponentType.ActionRow,
					components: [
						{
							type: ComponentType.StringSelect,
							custom_id: DM_CATEGORY_SELECT_CUSTOM_ID,
							placeholder: 'Select a category',
							options: buildCategorySelectOptions(categories),
						},
					],
				},
			],
		});
	});
}
