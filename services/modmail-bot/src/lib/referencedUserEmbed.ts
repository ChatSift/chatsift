import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';
import type { APIEmbed, APIEmbedField, APIGuildMember, APIUser } from '@discordjs/core';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { resolveGuildAvatarURL } from './avatars.js';

/**
 * Discord's "danger" red (matches `replyModeration.ts`'s `DELETED_COLOR`) -- deliberately alarming, since
 * this card exists specifically to flag a "heads up, verify who's actually being talked about" moment.
 */
const REFERENCED_USER_COLOR = 0xed4245;

/**
 * Matches a Discord mention (`<@id>`/`<@!id>`) or a bare snowflake-shaped number anywhere in free text —
 * #215's anti-ID-swapping QOL feature needs to catch both "\@mention the user" and "just paste the raw
 * ID", since a user reporting someone who's already left (or been banned from) the server can only do
 * the latter -- Discord can't render a resolvable mention for an account it has no shared-server
 * knowledge of. A single alternation rather than two separate passes so a mention's own digits can't
 * also get counted a second time as a "bare number" match.
 */
const REFERENCED_USER_ID_PATTERN = /<@!?(?<mentionId>\d{17,20})>|\b(?<rawId>\d{17,20})\b/g;

/**
 * Capped -- a message pasting a long list of ids (accidental or otherwise) shouldn't turn into a wall of
 * profile cards. Three comfortably covers the actual use case (calling out one or two other people in a
 * report) without needing a "+N more" affordance.
 */
const MAX_REFERENCED_USERS = 3;

/**
 * Extracts up to `MAX_REFERENCED_USERS` distinct candidate ids from a message's content. Not excluding
 * the author's own id here -- a user pasting/mentioning themselves still gets a real profile card, and
 * there's no reason to special-case that away. Whether each candidate is actually a real Discord account
 * is resolved separately, by `resolveReferencedUser` -- this step is pure string parsing only.
 */
export function extractReferencedUserIds(content: string): string[] {
	const ids = new Set<string>();
	for (const match of content.matchAll(REFERENCED_USER_ID_PATTERN)) {
		if (ids.size >= MAX_REFERENCED_USERS) {
			break;
		}

		const id = match.groups?.['mentionId'] ?? match.groups?.['rawId'];
		if (id) {
			ids.add(id);
		}
	}

	return [...ids];
}

interface ResolvedReferencedUser {
	member: APIGuildMember | null;
	user: APIUser;
}

function isUnknownUserOrMemberError(error: unknown): boolean {
	return (
		error instanceof DiscordAPIError &&
		(error.code === RESTJSONErrorCodes.UnknownUser || error.code === RESTJSONErrorCodes.UnknownMember)
	);
}

/**
 * A raw snowflake sitting in a user's message could be anything -- a real Discord id, or just a number
 * of the right length. `users.get` *is* the validity check (an id that was never a real account, or
 * never existed, 404s as `UnknownUser`), not merely an enrichment step. Membership is resolved
 * separately and is allowed to come back `null`: the entire point of #215 is that a referenced user who
 * has since left, or been banned, is still worth flagging -- that's exactly the "swap in someone who
 * already got banned" case the feature exists to catch, so a `null` member must never suppress the card.
 */
async function resolveReferencedUser(guildId: string, userId: string): Promise<ResolvedReferencedUser | null> {
	const api = getContext().service.client.api;

	let user: APIUser;
	try {
		user = await api.users.get(userId);
	} catch (error) {
		if (isUnknownUserOrMemberError(error)) {
			return null;
		}

		throw error;
	}

	let member: APIGuildMember | null = null;
	try {
		member = await api.guilds.getMember(guildId, userId);
	} catch (error) {
		if (!isUnknownUserOrMemberError(error)) {
			throw error;
		}
	}

	return { member, user };
}

/**
 * Discord ids encode their creation time in the top 42 bits (`timestamp = (id >> 22) + discordEpoch`) --
 * computed directly rather than pulling in a whole snowflake-parsing dependency for one arithmetic line.
 */
const DISCORD_EPOCH_MS = 1_420_070_400_000n;

function snowflakeTimestampSeconds(id: string): number {
	const ms = (BigInt(id) >> 22n) + DISCORD_EPOCH_MS;
	return Number(ms / 1_000n);
}

function buildReferencedUserEmbed(guildId: string, resolved: ResolvedReferencedUser): APIEmbed {
	const { member, user } = resolved;
	const avatarURL = resolveGuildAvatarURL(guildId, member ?? undefined, user);
	const displayName = member?.nick ?? user.global_name ?? user.username;

	const fields: APIEmbedField[] = [
		{ inline: true, name: 'Username', value: `@${user.username}` },
		{ inline: true, name: 'Account created', value: `<t:${snowflakeTimestampSeconds(user.id)}:R>` },
		member?.joined_at
			? {
					inline: true,
					name: 'Joined this server',
					value: `<t:${Math.floor(new Date(member.joined_at).getTime() / 1_000)}:R>`,
				}
			: { inline: true, name: 'Server membership', value: '⚠️ Not currently a member of this server' },
	];

	return {
		author: avatarURL ? { icon_url: avatarURL, name: displayName } : { name: displayName },
		color: REFERENCED_USER_COLOR,
		description: '🔎 *ID referenced in the replied-to message*',
		fields,
		footer: { text: `User ID: ${user.id}` },
		...(avatarURL ? { thumbnail: { url: avatarURL } } : {}),
	};
}

export interface PostReferencedUserEmbedsOptions {
	content: string;
	logger: Logger;
	/**
	 * The id of the relayed message this card is about -- the card is sent as a native reply to it (see
	 * below) rather than relying on send order, so which message it's actually about stays unambiguous
	 * even if another message gets relayed into the same thread while this one's REST lookups are still
	 * in flight.
	 */
	relayedMessageId: string;
	thread: Pick<Threads, 'guildId' | 'modThreadId'>;
}

/**
 * #215: scans a message the ticket opener just typed in their private thread for mentions/raw ids and
 * posts a compact follow-up profile card into the mod thread for each one that resolves to a real
 * Discord account -- anti "ID swapping" during a report (a user swaps in someone else's id/mention to
 * misdirect who a report is actually about). Deliberately unconditional: the original design called for
 * suppressing this when the referenced user is staff and the author is also staff, but that only makes
 * sense on a bot where staff can post in the thread too. This only ever runs on `relayUserMessageToModThread`
 * (the ticket opener's own messages -- staff replies are command-driven, never relayed through here), so
 * there is no "staff flagging staff" case to suppress in the first place; every resolved id gets a card.
 *
 * Best-effort and isolated per candidate id: a REST hiccup resolving one id, or the whole thing failing,
 * must never take down the message relay this runs alongside -- every failure is caught and logged here
 * rather than left to propagate.
 *
 * Nothing here is serialized against other messages in the same thread -- resolving a candidate id is a
 * couple of REST round-trips, easily slow enough for a second message (and its own relay copy) to land in
 * the mod thread first. Rather than adding a per-thread lock around the whole relay path just for this,
 * the follow-up is sent as a native Discord reply (`message_reference`) targeting the exact message it's
 * about, so Discord's own "replying to" UI keeps the association correct regardless of what else lands in
 * between -- `fail_if_not_exists: false` so a since-deleted relayed message degrades to a normal
 * (unanchored) message instead of failing the whole post.
 */
export async function postReferencedUserEmbeds({
	content,
	logger,
	relayedMessageId,
	thread,
}: PostReferencedUserEmbedsOptions): Promise<void> {
	const candidateIds = extractReferencedUserIds(content);
	if (candidateIds.length === 0) {
		return;
	}

	const embeds: APIEmbed[] = [];
	for (const id of candidateIds) {
		try {
			const resolved = await resolveReferencedUser(thread.guildId, id);
			if (resolved) {
				embeds.push(buildReferencedUserEmbed(thread.guildId, resolved));
			}
		} catch (error) {
			logger.warn({ err: error, userId: id }, 'Failed to resolve a referenced user id for the anti-swapping embed');
		}
	}

	if (embeds.length === 0) {
		return;
	}

	try {
		await getContext().service.client.api.channels.createMessage(thread.modThreadId, {
			embeds,
			message_reference: { fail_if_not_exists: false, message_id: relayedMessageId },
		});
	} catch (error) {
		logger.warn(
			{ err: error, modThreadId: thread.modThreadId },
			'Failed to post referenced-user embeds to the mod thread',
		);
	}
}
