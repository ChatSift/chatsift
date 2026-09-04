import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { Categories, Threads } from '@chatsift/db';
import type { APIEmbed, APIEmbedField, APIGuildMember, APIUser } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RESTJSONErrorCodes, RouteBases } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import type { PermissionRequirement } from './botPermissions.js';
import { findMissingPermissions, formatMissingPermissionsNotice, MOD_FORUM_PERMISSIONS } from './botPermissions.js';
import { getAnonReplyLabelTemplate, getGuildInfo } from './guild.js';
import { ticketsOpened } from './metrics.js';
import { templateDataFromMember, templateGuildName, templateString } from './templateString.js';
import {
	countPastThreadsForUser,
	incrementLocalMessageId,
	insertThreadMessage,
	isRecordingEnabled,
	MAX_THREAD_AUTO_ARCHIVE_DURATION_MINUTES,
} from './threads.js';

/**
 * Used for both the ticket-opening info embed and the greeting, distinct from the green/blurple
 * relay colors (`lib/relay.ts`) so "informational" posts read differently from an actual
 * back-and-forth message.
 */
const NOT_QUITE_BLACK = 0x23272a;

/**
 * Thrown by `finishTicketCreation` when the mod forum itself is unreachable -- the bot can't see it, can't post
 * in it, or it isn't there at all any more. Distinct from every other ticket-creation failure because the answer
 * is: a moderator has to fix the bot's permissions on that forum (or repoint it), and until they do, the opener
 * re-sending their message just fails identically. Caught by all three ticket-opening paths
 * (`index.ts#handleFirstMessage`, `lib/dmTicket.ts`, `components/dmCategorySelect.ts`) so they can say that
 * instead of offering a retry.
 *
 * The dashboard now refuses to save a mod forum the bot can't post in (`services/api`'s
 * `util/botPermissions.ts`), so reaching this means the permissions changed *after* it was configured.
 */
export class ModForumAccessError extends Error {
	public constructor(
		public readonly modForumId: string,
		cause: unknown,
	) {
		super(`the bot cannot open threads in mod forum ${modForumId}`, { cause });
		this.name = 'ModForumAccessError';
	}
}

/**
 * What the ticket opener is told when the above happens, shared by all three call sites so the wording is one
 * decision rather than three. Deliberately does not suggest trying again.
 */
export const MOD_FORUM_ACCESS_NOTICE =
	"❌ This server's ModMail isn't set up correctly right now — the bot can't reach the staff forum, so your ticket couldn't be opened. Please let a moderator know.";

/**
 * Discord's snowflake epoch (2015-01-01T00:00:00.000Z), used to derive account-creation date.
 */
const DISCORD_EPOCH = 1_420_070_400_000n;

function snowflakeCreatedAt(id: string): Date {
	return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

/**
 * Both halves of a date field: the absolute date on the first line, Discord's own relative rendering
 * ("3 years ago") on the second. The relative half is the one staff actually skim for -- "is this a
 * brand new account" / "did they join yesterday" -- but it's useless on its own once a ticket is a few
 * months old and someone reads it back, hence keeping both rather than picking one.
 */
function discordDate(date: Date): string {
	const seconds = Math.floor(date.getTime() / 1_000);
	return `<t:${seconds}:D>\n<t:${seconds}:R>`;
}

/**
 * Leaves room for the ` - Thread #N` suffix inside Discord's 100-character forum-thread-name cap, so a
 * long display name truncates instead of pushing the ticket number out of the title entirely -- the
 * number is the part staff search by, so it's the part that must survive.
 */
function buildModThreadName(displayName: string, threadId: number): string {
	const suffix = ` - Thread #${threadId}`;
	return `${displayName.slice(0, 100 - suffix.length)}${suffix}`;
}

/**
 * `finishTicketCreation` only ever runs from `index.ts`'s message-driven path (the `user`-less
 * `APIGuildMemberNoUser` the gateway attaches to `MESSAGE_CREATE`), never directly from an
 * interaction — narrowed to just the fields actually read here so that satisfies it.
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
	/**
	 * How this ticket was opened -- `'panel'` from `index.ts#handleFirstMessage`, `'dm'` from
	 * `lib/dmTicket.ts` (#216, P4). Stored on `threads.origin`; see that column's doc comment in
	 * schema.sql for what each caller must never do to `userChannelId` as a result.
	 */
	origin: Threads['origin'];
	user: APIUser;
	/**
	 * The Discord channel the user's side of the conversation happens in -- a private thread this bot
	 * created (`origin: 'panel'`) or the opener's DM channel (`origin: 'dm'`). See `threads.user_channel_id`'s
	 * doc comment in schema.sql for why this is deliberately not called "...threadId".
	 */
	userChannelId: string;
}

/**
 * Called once from `index.ts`'s `handleFirstMessage` (panel flow) or `lib/dmTicket.ts` (DM mode,
 * #216 P4), once the user's opening message is known -- the category (if any) was already resolved
 * before this point (`categorySelect.ts`/`dmTicket.ts`'s category prompt), so this only ever has one
 * job left: open the mod-forum thread (tagged per category, if configured), insert the `threads` row,
 * and post the category's greeting (falling back to the guild default) back into the user's channel.
 * The opening embed's field set (account age, join date, past tickets, roles) intentionally skips a
 * full guild-roles fetch just to sort the roles by position — not worth the extra API call for a
 * cosmetic ordering.
 */
export async function finishTicketCreation({
	alertRoleId,
	category,
	createdById,
	guildId,
	logger,
	member,
	modForumId,
	origin,
	user,
	userChannelId,
}: FinishTicketCreationOptions): Promise<Threads> {
	const displayName = member?.nick ?? user.global_name ?? user.username;
	const avatarURL = member?.avatar
		? `${RouteBases.cdn}${CDNRoutes.guildMemberAvatar(guildId, user.id, member.avatar, ImageFormat.PNG)}`
		: user.avatar
			? `${RouteBases.cdn}${CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.PNG)}`
			: undefined;

	const pastTicketCount = await countPastThreadsForUser(guildId, user.id);
	const roles = member?.roles.length ? member.roles.map((roleId) => `<@&${roleId}>`).join(', ') : 'none';
	const recording = await isRecordingEnabled(guildId);

	// Reserved *before* the forum thread even exists so the ticket number can be baked into its name from
	// the start -- renaming it after the fact via `channels.edit` works, but Discord posts an unhideable
	// "changed the post title" system message every time, which is worse than the problem it solves. A
	// gap in the sequence if ticket creation fails after this point (rare, and already handled below by
	// deleting the orphaned Discord thread) is a perfectly normal cost of a `GENERATED BY DEFAULT AS
	// IDENTITY` column -- nothing here depends on `threads.id` having no gaps.
	const [{ nextThreadId }] = await getContext().db<[{ nextThreadId: string }]>`
		SELECT nextval(pg_get_serial_sequence('threads', 'id')) AS next_thread_id
	`;
	const reservedThreadId = Number(nextThreadId) as Threads['id'];

	// Only worth linking when recording is on -- the dashboard search results a mod would land on show
	// recorded content, so following the link with recording off would just be a list of "not recorded"
	// placeholders.
	const pastTicketsSearchUrl = `${getContext().FRONTEND_URL}/dashboard/${guildId}/modmail/threads?search=${user.id}&include_closed=true`;
	const historyValue =
		pastTicketCount === 0
			? 'None'
			: [
					`${pastTicketCount} ticket${pastTicketCount === 1 ? '' : 's'}`,
					...(recording ? [`[Open dashboard](${pastTicketsSearchUrl})`] : []),
				].join('\n');

	// Discord lays inline fields out three to a row, so this ordering is the layout: one row of
	// "who is this" context, then roles on a full-width row of its own (a role list wraps badly in a
	// third-of-a-row column), then the ticket's own metadata.
	const openingEmbedFields: APIEmbedField[] = [
		...(member?.joined_at
			? [{ name: 'Joined Server', value: discordDate(new Date(member.joined_at)), inline: true }]
			: []),
		{ name: 'Account Created', value: discordDate(snowflakeCreatedAt(user.id)), inline: true },
		{ name: 'History', value: historyValue, inline: true },
		{ name: 'Roles', value: roles, inline: false },
		...(category ? [{ name: 'Category', value: category.name, inline: true }] : []),
		{ name: 'Opened By', value: `<@${createdById}>`, inline: true },
		...(recording
			? [
					{
						name: 'Dashboard',
						value: `[View this ticket](${getContext().FRONTEND_URL}/dashboard/${guildId}/modmail/threads/${reservedThreadId})`,
						inline: true,
					},
				]
			: []),
	];

	const openingEmbed: APIEmbed = {
		color: NOT_QUITE_BLACK,
		author: avatarURL ? { name: displayName, icon_url: avatarURL } : { name: displayName },
		footer: { text: `${user.username} (${user.id})` },
		fields: openingEmbedFields,
		timestamp: new Date().toISOString(),
	};

	const missingPermissions = findMissingPermissions(guildId, modForumId, MOD_FORUM_PERMISSIONS, logger);

	// The info embed is the thread's starter message unconditionally. It used to be displaced into a
	// follow-up message whenever recording was on, because a "this ticket is being recorded" notice had to
	// take the starter slot (Discord bakes whatever's passed to `message` here in as the very first post,
	// and nothing can be inserted before it after the fact) -- that notice is gone, so the split it forced
	// is gone with it. Linking to the dashboard from here is fine despite the `threads` row not existing
	// yet: `reservedThreadId` is the id the INSERT below uses.
	let modThread;
	try {
		modThread = await getContext().service.client.api.channels.createForumThread(modForumId, {
			name: buildModThreadName(displayName, reservedThreadId),
			applied_tags: category?.forumTagId ? [category.forumTagId] : undefined,
			auto_archive_duration: MAX_THREAD_AUTO_ARCHIVE_DURATION_MINUTES,
			message: {
				// Plain content, not an embed field — embeds never trigger a ping, and this is the one
				// place a new ticket should actually notify the configured alert role.
				...(alertRoleId ? { content: `<@&${alertRoleId}>` } : {}),
				embeds: [openingEmbed],
			},
		});
	} catch (error) {
		// Covers both 403s Discord can answer with here -- `50001 Missing Access` (the forum isn't even visible
		// to the bot) and `50013 Missing Permissions` (visible, but it can't post) -- plus `10003 Unknown Channel`
		// (#397), which is what a forum that has since been *deleted* answers with. `guild_settings.mod_forum_id` outlives
		// the channel it points at (nothing clears it when the channel goes away), so that last one is a perfectly
		// ordinary state for a guild to be in, and it means the same thing to the opener as the other two: only a
		// moderator can fix it. Left as a raw error it instead logged at error level on every single message the
		// user sent and told them to try again, which could never work.
		if (
			error instanceof DiscordAPIError &&
			(error.status === 403 || error.code === RESTJSONErrorCodes.UnknownChannel)
		) {
			throw new ModForumAccessError(modForumId, error);
		}

		throw error;
	}

	// If the INSERT fails outright or somehow returns no row, the forum thread above is already live on
	// Discord's side with nothing in our DB pointing at it — clean that up rather than leaving an
	// orphaned thread a mod would see but that no `/reply` command could ever resolve back to a ticket.
	let thread: Threads | undefined;
	try {
		[thread] = await getContext().db<Threads[]>`
			INSERT INTO threads (id, guild_id, mod_thread_id, user_id, created_by_id, category_id, user_channel_id, origin)
			VALUES (
				${reservedThreadId}, ${guildId}, ${modThread.id}, ${user.id}, ${createdById}, ${category?.id ?? null},
				${userChannelId}, ${origin}
			)
			RETURNING *
		`;

		if (!thread) {
			throw new Error(`Failed to insert thread row for mod thread ${modThread.id}`);
		}

		// Counted here rather than at any of the four call sites, so a new way of opening a ticket can't be
		// added without it. `origin` is `threads.origin`'s own closed set, so the counter and the column always
		// answer the question the same way.
		ticketsOpened.inc({ origin });
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

	logger.info({ threadId: thread.id, modThreadId: modThread.id, userChannelId }, 'Opened new modmail ticket');

	await warnAboutMissingModForumPermissions(await missingPermissions, guildId, modForumId, modThread.id, logger);

	return thread;
}

async function warnAboutMissingModForumPermissions(
	missing: PermissionRequirement[] | null,
	guildId: string,
	modForumId: string,
	modThreadId: string,
	logger: Logger,
): Promise<void> {
	if (!missing?.length) {
		return;
	}

	try {
		logger.warn(
			{ guildId, modForumId, missing: missing.map((requirement) => requirement.permission.toString()) },
			'Opened a ticket in a mod forum the bot is missing permissions in',
		);

		await getContext().service.client.api.channels.createMessage(modThreadId, {
			content: formatMissingPermissionsNotice(missing, modForumId),
			allowed_mentions: { parse: [] },
		});
	} catch (error) {
		logger.warn({ err: error, guildId, modForumId }, 'Failed to warn about missing mod forum permissions');
	}
}

interface GreetingContent {
	embed: APIEmbed;
	resolvedContent: string;
}

/**
 * Shared by `sendEarlyGreeting` and `sendGreeting` — the embed and its resolved text don't depend on
 * when or where it ends up posted, only the destination(s) and recording do.
 */
async function buildGreetingContent({
	category,
	defaultGreetingMessage,
	guildId,
	member,
	user,
}: {
	category: Categories | null;
	defaultGreetingMessage: string | null;
	guildId: string;
	member: MemberLike | undefined;
	user: APIUser;
}): Promise<GreetingContent | null> {
	const greeting = category?.greetingMessage ?? defaultGreetingMessage;
	if (!greeting || !member) {
		return null;
	}

	const [guild, labelTemplate] = await Promise.all([getGuildInfo(guildId), getAnonReplyLabelTemplate(guildId)]);
	const label = templateGuildName(labelTemplate, guild.name);

	// Same divergence from ChatSift/ModMail as anon replies (lib/relay.ts): the "\{guildName\} Team" identity
	// lives in the footer, not the author slot — an author line here would just duplicate it.
	const resolvedContent = templateString(greeting, templateDataFromMember(guild.name, member, user));
	return {
		embed: {
			color: NOT_QUITE_BLACK,
			description: resolvedContent,
			footer: guild.iconURL ? { text: label, icon_url: guild.iconURL } : { text: label },
		},
		resolvedContent,
	};
}

export interface SendEarlyGreetingOptions {
	category: Categories | null;
	defaultGreetingMessage: string | null;
	guildId: string;
	member: MemberLike | undefined;
	user: APIUser;
	userChannelId: string;
}

/**
 * `guild_settings.greetingBeforeOpener`'s "before" only has anything to reorder against on the mod
 * side (`sendGreeting` below) — on the user's own channel, the opener *is* the message that triggers
 * ticket creation, so it already exists there before the bot can react at all; no ordering of calls at
 * finish time can land a bot reply ahead of the message that caused the bot to run. The only way to
 * actually greet the user before their own opener is to post here, at private-thread-creation time
 * (`createTicket.ts`/`categorySelect.ts`), before they've said anything. Returns the posted message's
 * id — threaded through `PendingTicketState.greetingUserMessageId` so `sendGreeting` can skip
 * re-posting to the user and reuse this id for recording once a real `threads` row exists — or `null`
 * if no greeting is configured for this category/guild.
 */
export async function sendEarlyGreeting({
	category,
	defaultGreetingMessage,
	guildId,
	member,
	user,
	userChannelId,
}: SendEarlyGreetingOptions): Promise<string | null> {
	const content = await buildGreetingContent({ category, defaultGreetingMessage, guildId, member, user });
	if (!content) {
		return null;
	}

	const message = await getContext().service.client.api.channels.createMessage(userChannelId, {
		embeds: [content.embed],
	});
	return message.id;
}

export interface SendGreetingOptions {
	category: Categories | null;
	defaultGreetingMessage: string | null;
	/**
	 * Set when `sendEarlyGreeting` already posted the user-facing copy (`greetingBeforeOpener`, before
	 * the opener arrived) — skips re-posting to `userChannelId` and reuses this id for recording instead.
	 */
	earlyUserMessageId?: string | undefined;
	guildId: string;
	member: MemberLike | undefined;
	modThreadId: string;
	threadId: Threads['id'];
	user: APIUser;
	userChannelId: string;
}

/**
 * Deliberately not part of `finishTicketCreation` — `index.ts`'s `handleFirstMessage` relays the
 * user's own first message to the mod thread itself right after creating it, and needs to sequence
 * this against that relay call depending on `guild_settings.greetingBeforeOpener` (default `false`:
 * greeting lands *after* the relay, so the mod-side thread reads opening info embed, then the user's
 * actual message, then the bot's greeting reply to it — set `true` to flip that order). Posting the
 * greeting from inside `finishTicketCreation` would hardcode one order with no way for the caller to
 * flip it.
 */
export async function sendGreeting({
	category,
	defaultGreetingMessage,
	earlyUserMessageId,
	guildId,
	member,
	modThreadId,
	threadId,
	user,
	userChannelId,
}: SendGreetingOptions): Promise<void> {
	const content = await buildGreetingContent({ category, defaultGreetingMessage, guildId, member, user });
	if (!content) {
		return;
	}

	// Posted into both threads — mods should see the automated greeting land in the mod-forum
	// thread too, the same way a staff-sent reply's log copy does, instead of it only being
	// visible from the user's side. `earlyUserMessageId` set means `sendEarlyGreeting` already put the
	// user-facing copy out, so only the mod-thread copy needs posting here.
	const [userMessageId, modMessage] = await Promise.all([
		earlyUserMessageId
			? Promise.resolve(earlyUserMessageId)
			: getContext()
					.service.client.api.channels.createMessage(userChannelId, { embeds: [content.embed] })
					.then((message) => message.id),
		getContext().service.client.api.channels.createMessage(modThreadId, { embeds: [content.embed] }),
	]);

	// Recorded the same way a staff reply is (Phase 3, #261) -- `is_system` distinguishes it from a real
	// staff/user message on read, since there's no actual staff actor for a `staffId` to name (see
	// schema.sql's own doc comment). Only inserted when recording is enabled at all, same as internal
	// mod-chatter -- an unrecorded system row would carry zero information.
	if (await isRecordingEnabled(guildId)) {
		const localThreadMessageId = await incrementLocalMessageId(threadId);
		await insertThreadMessage({
			anon: false,
			content: {
				attachments: [],
				isForwarded: false,
				repliedToThreadMessageId: null,
				stickers: [],
				text: content.resolvedContent,
			},
			guildId,
			guildMessageId: modMessage.id,
			isSystem: true,
			localThreadMessageId,
			staffId: null,
			threadId,
			userId: user.id,
			userMessageId,
		});
	}
}
