import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { Categories, Threads } from '@chatsift/db';
import type { APIEmbed, APIGuildMember, APIUser } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';
import { getAnonReplyLabelTemplate, getGuildInfo } from './guild.js';
import { templateDataFromMember, templateGuildName, templateString } from './templateString.js';
import { countPastThreadsForUser, MAX_THREAD_AUTO_ARCHIVE_DURATION_MINUTES } from './threads.js';

/**
 * Matches prod ChatSift/ModMail's `Colors.NotQuiteBlack` — used for both the ticket-opening info
 * embed and the greeting, distinct from the green/blurple relay colors (`lib/relay.ts`) so
 * "informational" posts read differently from an actual back-and-forth message.
 */
const NOT_QUITE_BLACK = 0x23272a;

/**
 * Discord's snowflake epoch (2015-01-01T00:00:00.000Z), used to derive account-creation date.
 */
const DISCORD_EPOCH = 1_420_070_400_000n;

function snowflakeCreatedAt(id: string): Date {
	return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

function discordDate(date: Date): string {
	return `<t:${Math.floor(date.getTime() / 1_000)}:D>`;
}

/**
 * Called from both interaction-driven paths (`createTicket.ts`/`categorySelect.ts`, a full
 * `APIGuildMember`) and the message-driven zero-category path (`index.ts`, the `user`-less
 * `APIGuildMemberNoUser` the gateway attaches to `MESSAGE_CREATE`) — narrowed to just the fields
 * actually read here so both satisfy it.
 */
type MemberLike = Pick<APIGuildMember, 'avatar' | 'joined_at' | 'nick' | 'roles'>;

export interface FinishTicketCreationOptions {
	alertRoleId: string | null;
	category: Categories | null;
	createdById: string;
	guildId: string;
	logger: Logger;
	member: MemberLike | undefined;
	modForumId: string;
	privateThreadId: string;
	user: APIUser;
}

/**
 * Shared by both ticket-creation paths (a panel with no categories skips straight here, a panel with
 * categories reaches this once `categorySelect.ts` resolves a pick): opens the mod-forum thread
 * (tagged per category, if configured), inserts the `threads` row, and posts the category's greeting
 * (falling back to the guild default) back into the user's private thread. The opening embed's field
 * set (account age, join date, past tickets, roles) is drawn from prod ChatSift/ModMail's
 * `handleThreadManagement.ts` "who is this" panel, minus a full guild-roles fetch just to sort them
 * by position.
 */
export async function finishTicketCreation({
	alertRoleId,
	category,
	createdById,
	guildId,
	logger,
	member,
	modForumId,
	privateThreadId,
	user,
}: FinishTicketCreationOptions): Promise<Threads> {
	const displayName = member?.nick ?? user.global_name ?? user.username;
	const avatarURL = member?.avatar
		? `${RouteBases.cdn}${CDNRoutes.guildMemberAvatar(guildId, user.id, member.avatar, ImageFormat.PNG)}`
		: user.avatar
			? `${RouteBases.cdn}${CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.PNG)}`
			: undefined;

	const pastTicketCount = await countPastThreadsForUser(guildId, user.id);
	const roles = member?.roles.length ? member.roles.map((roleId) => `<@&${roleId}>`).join(', ') : 'none';

	const openingEmbed: APIEmbed = {
		color: NOT_QUITE_BLACK,
		author: avatarURL ? { name: displayName, icon_url: avatarURL } : { name: displayName },
		footer: { text: `${user.username} (${user.id})` },
		fields: [
			{ name: 'Account Created', value: discordDate(snowflakeCreatedAt(user.id)), inline: true },
			...(member?.joined_at
				? [{ name: 'Joined Server', value: discordDate(new Date(member.joined_at)), inline: true }]
				: []),
			{ name: 'Past Tickets', value: String(pastTicketCount), inline: true },
			...(category ? [{ name: 'Category', value: category.name, inline: true }] : []),
			{ name: 'Opened By', value: `<@${createdById}>`, inline: true },
			{ name: 'Roles', value: roles, inline: true },
		],
		timestamp: new Date().toISOString(),
	};

	const modThread = await getContext().service.client.api.channels.createForumThread(modForumId, {
		name: `${displayName}`.slice(0, 100),
		applied_tags: category?.forumTagId ? [category.forumTagId] : undefined,
		auto_archive_duration: MAX_THREAD_AUTO_ARCHIVE_DURATION_MINUTES,
		message: {
			// Plain content, not an embed field — embeds never trigger a ping, and this is the one
			// place a new ticket should actually notify the configured alert role.
			...(alertRoleId ? { content: `<@&${alertRoleId}>` } : {}),
			embeds: [openingEmbed],
		},
	});

	// If the INSERT fails outright or somehow returns no row, the forum thread above is already live on
	// Discord's side with nothing in our DB pointing at it — clean that up rather than leaving an
	// orphaned thread a mod would see but that no `/reply` command could ever resolve back to a ticket.
	let thread: Threads | undefined;
	try {
		[thread] = await getContext().db<Threads[]>`
			INSERT INTO threads (guild_id, mod_thread_id, user_id, created_by_id, category_id, user_thread_id)
			VALUES (${guildId}, ${modThread.id}, ${user.id}, ${createdById}, ${category?.id ?? null}, ${privateThreadId})
			RETURNING *
		`;

		if (!thread) {
			throw new Error(`Failed to insert thread row for mod thread ${modThread.id}`);
		}
	} catch (error) {
		logger.error(
			{ err: error, modThreadId: modThread.id },
			'Failed to persist new ticket, deleting orphaned mod thread',
		);
		await getContext().service.client.api.channels.delete(modThread.id, {
			reason: 'Rolling back failed ticket creation',
		});
		throw error;
	}

	logger.info({ threadId: thread.id, modThreadId: modThread.id, privateThreadId }, 'Opened new modmail ticket');

	return thread;
}

export interface SendGreetingOptions {
	category: Categories | null;
	defaultGreetingMessage: string | null;
	guildId: string;
	member: MemberLike | undefined;
	modThreadId: string;
	privateThreadId: string;
	user: APIUser;
}

/**
 * Deliberately not part of `finishTicketCreation` — callers relay the user's own first message to
 * the mod thread themselves right after creating it (see `index.ts`/`categorySelect.ts`), and need to
 * sequence this against that relay call themselves depending on `guild_settings.greetingBeforeOpener`
 * (default `false`: greeting lands *after* the relay, so the mod-side thread reads opening info embed,
 * then the user's actual message, then the bot's greeting reply to it — set `true` to flip that order).
 * Posting the greeting from inside `finishTicketCreation` would hardcode one order with no way for
 * callers to flip it.
 */
export async function sendGreeting({
	category,
	defaultGreetingMessage,
	guildId,
	member,
	modThreadId,
	privateThreadId,
	user,
}: SendGreetingOptions): Promise<void> {
	const greeting = category?.greetingMessage ?? defaultGreetingMessage;
	if (!greeting || !member) {
		return;
	}

	const [guild, labelTemplate] = await Promise.all([getGuildInfo(guildId), getAnonReplyLabelTemplate(guildId)]);
	const label = templateGuildName(labelTemplate, guild.name);

	// Same divergence from prod as anon replies (lib/relay.ts): the "\{guildName\} Team" identity
	// lives in the footer, not the author slot — an author line here would just duplicate it.
	const greetingEmbed: APIEmbed = {
		color: NOT_QUITE_BLACK,
		description: templateString(greeting, templateDataFromMember(guild.name, member, user)),
		footer: guild.iconURL ? { text: label, icon_url: guild.iconURL } : { text: label },
	};

	// Posted into both threads — mods should see the automated greeting land in the mod-forum
	// thread too, the same way a staff-sent reply's log copy does, instead of it only being
	// visible from the user's side.
	await Promise.all([
		getContext().service.client.api.channels.createMessage(privateThreadId, { embeds: [greetingEmbed] }),
		getContext().service.client.api.channels.createMessage(modThreadId, { embeds: [greetingEmbed] }),
	]);
}
