import { URL } from 'node:url';
import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { Categories, Threads, ThreadsId } from '@chatsift/db';
import type { APIGuildMember, APIUser, Snowflake } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { discordAPIModmail } from '../../../util/discordAPI.js';

/**
 * Shared enrichment helpers for `listThreads.ts`/`getThread.ts` (#261) -- kept out of both route files
 * so the two don't quietly drift on what "a thread's category badge" or "an unresolvable user" means.
 */

export interface ThreadCategory {
	emoji: string | null;
	id: number;
	name: string;
}

export function toThreadCategory(category: Pick<Categories, 'emoji' | 'id' | 'name'> | null): ThreadCategory | null {
	return category ? { emoji: category.emoji, id: category.id, name: category.name } : null;
}

/**
 * Resolves a raw Discord user id to the full `APIUser` via the ModMail bot's own token -- a global user
 * lookup, not a guild-member one, so this still resolves a user who's since left the guild. Falls back to
 * the bare snowflake on a 404 (account deleted, or Discord just doesn't know it) rather than failing the
 * whole request over one unresolvable id.
 */
export async function resolveUser(userId: Snowflake): Promise<APIUser | Snowflake> {
	try {
		return await discordAPIModmail.users.get(userId);
	} catch (error) {
		if (error instanceof DiscordAPIError && error.status === 404) {
			return userId;
		}

		throw error;
	}
}

/**
 * `resolveUser` re-throws anything that isn't a plain 404 (rate limits, a transient 5xx, the bot's token
 * being briefly invalid) -- fine for `getThread.ts`/`listThreads.ts`, where a participant's name is core to
 * the response. The config screen's "Enabled by" audit line is a nice-to-have annotation on top of settings
 * that otherwise have nothing to do with Discord's API being up, so a transient failure resolving it
 * shouldn't fail the whole config GET/PATCH -- falls back to the bare snowflake and logs instead, same
 * fallback shape a real 404 already gets.
 */
export async function resolveUserBestEffort(userId: Snowflake, logger: Logger): Promise<APIUser | Snowflake> {
	try {
		return await resolveUser(userId);
	} catch (error) {
		logger.warn({ err: error, userId }, 'Failed to resolve recordThreadContentEnabledBy for the config audit line');
		return userId;
	}
}

/**
 * Resolves a guild member for the thread sidebar's role list -- role *names* are looked up client-side
 * against `useGuildInfo` (the dashboard already caches a guild's roles for that), so this only needs the
 * member's role id list, not a fully hydrated roles response. `null` covers both "left the guild" and
 * "bot no longer has access", which the frontend renders identically (nothing to show).
 */
export async function resolveMember(guildId: Snowflake, userId: Snowflake): Promise<APIGuildMember | null> {
	try {
		return await discordAPIModmail.guilds.getMember(guildId, userId);
	} catch (error) {
		if (error instanceof DiscordAPIError && error.status === 404) {
			return null;
		}

		throw error;
	}
}

/**
 * The mod-forum thread's own applied tags -- works for an archived (closed) thread the same as an open
 * one, since closing only locks+archives it (`services/modmail-bot`'s `lib/threadClose.ts`), never
 * deletes it. Falls back to an empty list if the channel is somehow gone rather than failing the request,
 * even though that's not expected to happen given the above.
 */
export async function resolveAppliedTagIds(modThreadId: Snowflake): Promise<Snowflake[]> {
	try {
		// `applied_tags` only exists on a forum's child thread channel (never on the forum channel
		// itself), which isn't its own distinct type in `@discordjs/core` -- narrowed by hand here rather
		// than importing every thread-channel variant just to union them.
		const channel = await discordAPIModmail.channels.get(modThreadId);
		return (channel as { applied_tags?: Snowflake[] }).applied_tags ?? [];
	} catch (error) {
		if (error instanceof DiscordAPIError && error.status === 404) {
			return [];
		}

		throw error;
	}
}

/**
 * Mirrors `services/modmail-bot`'s `lib/threads.ts#countPastThreadsForUser` -- duplicated rather than
 * shared across the service boundary, same call shape either side.
 */
export async function countPastThreadsForUser(guildId: string, userId: string): Promise<number> {
	const [row] = await getContext().db<[{ count: string }]>`
		SELECT COUNT(*) FROM threads WHERE guild_id = ${guildId} AND user_id = ${userId}
	`;

	return Number(row?.count ?? 0);
}

/**
 * Sibling tickets for the same user, for the "navigate to this user's other threads" nav -- newest first,
 * capped rather than paginated (this is a quick-nav list, not a browsable one; #261's own pagination
 * design is for the top-level thread list and a single thread's messages, not this).
 */
const MAX_OTHER_THREADS = 50;

export async function fetchOtherThreadsForUser(
	guildId: string,
	userId: string,
	excludeThreadId: ThreadsId,
): Promise<Threads[]> {
	return getContext().db<Threads[]>`
		SELECT * FROM threads
		WHERE guild_id = ${guildId} AND user_id = ${userId} AND id != ${excludeThreadId}
		ORDER BY id DESC
		LIMIT ${MAX_OTHER_THREADS}
	`;
}

/**
 * Matches `thread_message_content.attachments`'s stored JSONB shape (see schema.sql /
 * `services/modmail-bot`'s `lib/threads.ts#RecordedAttachment`).
 */
export interface RecordedAttachmentJson {
	contentType: string | null;
	filename: string;
	size: number;
	url: string;
}

export interface ResolvedThreadMessageAttachment extends RecordedAttachmentJson {
	/**
	 * `false` when the attachment's url had expired and re-fetching the source message either came back
	 * without a matching attachment or 404'd outright -- the frontend renders this as "attachment no
	 * longer exists on Discord" instead of trying to load `url` (which is left at its last-known,
	 * possibly-stale value purely for debugging, not for the frontend to actually use).
	 */
	available: boolean;
}

/**
 * Discord's attachment CDN urls carry a signed expiry (the `ex` query param, a hex unix-seconds
 * timestamp) rather than being permanent. An expired-looking url that fails to parse as a url at all, or
 * has no `ex` param, is treated as *not* expired -- this only ever triggers a refetch on a url shape we
 * actually recognize as stale, never speculatively.
 */
const HEX_PATTERN = /^[\da-f]+$/i;

function isAttachmentUrlExpired(url: string): boolean {
	try {
		const ex = new URL(url).searchParams.get('ex');
		// `Number.parseInt(ex, 16)` alone would happily parse a leading valid-hex prefix off a garbage
		// value (e.g. `"12g34"` -> `18`) instead of rejecting it outright -- validate the full string is
		// hex first so a malformed `ex` can't be misread as some arbitrary (and possibly "expired") timestamp.
		if (!ex || !HEX_PATTERN.test(ex)) {
			return false;
		}

		const expiresAtMs = Number.parseInt(ex, 16) * 1_000;
		return Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs;
	} catch {
		return false;
	}
}

/**
 * Refreshes recorded attachment urls on read instead of accepting permanent staleness or re-hosting the
 * files ourselves -- the mod-forum message these were re-uploaded onto is never deleted (#261's core
 * storage decision), so a signed-url expiry can always be healed by re-fetching that same message and
 * matching its current attachments back up by filename (stable across refetches, unlike the url itself).
 * Only actually re-fetches when at least one attachment looks expired, and the refreshed url is *not*
 * persisted back to `thread_message_content` -- it'll just re-expire eventually, and keeping this a
 * side-effect-free read keeps a GET route simple. If the message itself is gone (the durable record
 * deleted out of band -- not expected, but not impossible), every attachment on it is flagged
 * `available: false` rather than failing the request.
 */
export async function resolveMessageAttachments(
	modThreadId: Snowflake,
	guildMessageId: Snowflake,
	attachments: RecordedAttachmentJson[],
): Promise<ResolvedThreadMessageAttachment[]> {
	if (attachments.length === 0 || !attachments.some((attachment) => isAttachmentUrlExpired(attachment.url))) {
		return attachments.map((attachment) => ({ ...attachment, available: true }));
	}

	try {
		const message = await discordAPIModmail.channels.getMessage(modThreadId, guildMessageId);
		const byFilename = new Map(message.attachments.map((attachment) => [attachment.filename, attachment]));

		return attachments.map((attachment): ResolvedThreadMessageAttachment => {
			const fresh = byFilename.get(attachment.filename);
			if (!fresh) {
				return { ...attachment, available: false };
			}

			return {
				available: true,
				contentType: fresh.content_type ?? attachment.contentType,
				filename: attachment.filename,
				size: fresh.size,
				url: fresh.url,
			};
		});
	} catch (error) {
		if (error instanceof DiscordAPIError && error.status === 404) {
			return attachments.map((attachment) => ({ ...attachment, available: false }));
		}

		throw error;
	}
}
