import { getContext } from '@chatsift/backend-core';
import type { Threads, ThreadMessages, ThreadMessagesId, ThreadMessageContent } from '@chatsift/db';
import type postgres from 'postgres';

/**
 * The longest `auto_archive_duration` Discord offers (7 days, in minutes). Used for both a ticket's
 * private thread and its mod-forum thread so an idle-but-open conversation takes as long as possible
 * to get caught by Discord's own archive timer in the first place — `preventThreadArchive.ts`'s sweep
 * is the backstop for whatever this doesn't already prevent. No longer boost-gated: Discord dropped
 * the server-boost requirement for this tier in 2022, so it's available to every guild.
 */
export const MAX_THREAD_AUTO_ARCHIVE_DURATION_MINUTES = 10_080;

/**
 * A user's total concurrent tickets in a guild, counting both real open `threads` rows and tickets
 * still mid-setup (`pending_tickets` — private thread created, no `threads` row yet since the mod-forum
 * side hasn't been resolved, which only happens once the user's opening message arrives). Both count
 * against `guild_settings.max_concurrent_threads` because a pending ticket already holds a private
 * thread and will become a real one imminently — not counting it would let a burst of clicks (all
 * still pending) blow past the limit before any of them finish. Checked as a fast pre-check by
 * `createTicket.ts` and, authoritatively, by `categorySelect.ts` immediately before it actually creates
 * a private thread — both under the same per guild+user lock (`lib/guildUserQueue.ts`) every other
 * ticket-lifecycle step uses, so the categorized path's count can't go stale between its check and the
 * create.
 */
export async function countActiveTicketsForUser(guildId: string, userId: string): Promise<number> {
	const [row] = await getContext().db<[{ count: string }]>`
		SELECT (
			(SELECT COUNT(*) FROM threads WHERE guild_id = ${guildId} AND user_id = ${userId} AND closed_at IS NULL) +
			(SELECT COUNT(*) FROM pending_tickets WHERE guild_id = ${guildId} AND user_id = ${userId})
		) AS count
	`;

	return Number(row?.count ?? 0);
}

/**
 * A user's open tickets within one specific category, checked against `categories.max_concurrent_threads`
 * (falling back to the guild's general limit) by `categorySelect.ts` once a category is actually picked —
 * unlike the general limit above, a category can't be known until then, so this can't be checked any
 * earlier in the flow. Same combined-count shape as `countActiveTicketsForUser` above and for the same
 * reason: a category pick that's already created a private thread but is still waiting on the user's
 * opening message (`pending_tickets`, with `category_id` set the moment the pick resolves — see
 * `categorySelect.ts`) has no `threads` row yet, so counting `threads` alone would let a burst of picks
 * for the *same* category blow past its limit before any of them finish.
 */
export async function countOpenThreadsForUserInCategory(
	guildId: string,
	userId: string,
	categoryId: number,
): Promise<number> {
	const [row] = await getContext().db<[{ count: string }]>`
		SELECT (
			(SELECT COUNT(*) FROM threads
				WHERE guild_id = ${guildId} AND user_id = ${userId} AND category_id = ${categoryId} AND closed_at IS NULL) +
			(SELECT COUNT(*) FROM pending_tickets
				WHERE guild_id = ${guildId} AND user_id = ${userId} AND category_id = ${categoryId})
		) AS count
	`;

	return Number(row?.count ?? 0);
}

/**
 * A user's open DM-origin tickets in a guild. DM mode's concurrency-1 cap (#216, P4) is fully enforced
 * in P5; until then `components/dmCategorySelect.ts` uses this to close the one race that matters
 * without it -- an opener's category pick can land up to `PENDING_TICKET_TTL_MS` later, so a second DM
 * opener started (and picked) in the meantime could otherwise create a second ticket for the same user.
 */
export async function countOpenDmThreadsForUser(guildId: string, userId: string): Promise<number> {
	const [row] = await getContext().db<[{ count: string }]>`
		SELECT COUNT(*) FROM threads
			WHERE guild_id = ${guildId} AND user_id = ${userId} AND origin = 'dm' AND closed_at IS NULL
	`;

	return Number(row?.count ?? 0);
}

/**
 * Every open ticket a user has in a guild, any origin. `lib/dmTicket.ts#handleDmMessage` uses this to
 * redirect a DM to an already-open *panel*-origin ticket instead of starting a second, parallel one via
 * DM mode -- a DM-origin open ticket can never show up here in practice (a user has exactly one DM
 * channel with the bot, so an open DM-origin thread's `user_channel_id` always equals the very message
 * that would already have matched `findOpenThreadByUserChannelId` upstream in `registerMessageRelay`,
 * before `handleDmMessage` is ever reached at all).
 */
export async function findOpenThreadsForUser(guildId: string, userId: string): Promise<Threads[]> {
	return getContext().db<Threads[]>`
		SELECT * FROM threads WHERE guild_id = ${guildId} AND user_id = ${userId} AND closed_at IS NULL
	`;
}

/**
 * Shown as a field on the ticket-opening embed (`lib/ticketCreation.ts`) — how many prior tickets
 * this user has had in the guild, closed or not, mirroring prod ChatSift/ModMail's "Past Modmails"
 * field.
 */
export async function countPastThreadsForUser(guildId: string, userId: string): Promise<number> {
	const [row] = await getContext().db<[{ count: string }]>`
		SELECT COUNT(*) FROM threads WHERE guild_id = ${guildId} AND user_id = ${userId}
	`;

	return Number(row?.count ?? 0);
}

/**
 * Looked up on every message posted anywhere (a private thread's or a DM's), to check whether the
 * channel is a ticket's user-side channel (user → mod relay direction). Most channels won't match,
 * hence the partial index on `user_channel_id`.
 */
export async function findOpenThreadByUserChannelId(userChannelId: string): Promise<Threads | undefined> {
	const [thread] = await getContext().db<Threads[]>`
		SELECT * FROM threads WHERE user_channel_id = ${userChannelId} AND closed_at IS NULL
	`;

	return thread;
}

/**
 * Looked up whenever `/reply` or `/reply-q` runs, to resolve the ticket the command was invoked in
 * (mod → user relay direction) and reject the command outside of one.
 */
export async function findOpenThreadByModThreadId(modThreadId: string): Promise<Threads | undefined> {
	const [thread] = await getContext().db<Threads[]>`
		SELECT * FROM threads WHERE mod_thread_id = ${modThreadId} AND closed_at IS NULL
	`;

	return thread;
}

/**
 * Atomically reserves the next local per-thread message number. A gap can appear if the Discord
 * post that follows this call fails (accepted tradeoff, see relay.ts) — the numbering only needs to
 * stay monotonic and unique per thread, not gapless.
 */
export async function incrementLocalMessageId(threadId: Threads['id']): Promise<number> {
	const [row] = await getContext().db<[{ lastLocalThreadMessageId: number }]>`
		UPDATE threads
		SET last_local_thread_message_id = last_local_thread_message_id + 1
		WHERE id = ${threadId}
		RETURNING last_local_thread_message_id
	`;

	if (!row) {
		throw new Error(`Failed to increment local message id for thread ${threadId}`);
	}

	return row.lastLocalThreadMessageId;
}

/**
 * Resolves a Discord-native reply's target to the message id it was relayed as in the mod thread, so
 * the relay can link straight to it ("replying to [this message](...)") — mods never see our internal
 * local numbering, so that's not useful to reference here. Matches on `user_message_id` since that
 * column holds the id of whichever message actually appeared in the private thread (the user's own
 * message, or a relayed staff reply, both go through `insertThreadMessage`). Also returns the target
 * row's own `id` (not just its Discord message id) -- `relay.ts` reuses this same lookup a second time
 * to resolve `thread_message_content.replied_to_thread_message_id` when recording is enabled, since it
 * already runs the exact query needed for that.
 */
export async function findRepliedToGuildMessageId(
	threadId: Threads['id'],
	userMessageId: string,
): Promise<{ guildMessageId: string; id: ThreadMessagesId } | undefined> {
	const [row] = await getContext().db<[{ guildMessageId: string; id: ThreadMessagesId }]>`
		SELECT id, guild_message_id FROM thread_messages WHERE thread_id = ${threadId} AND user_message_id = ${userMessageId}
	`;

	return row;
}

/**
 * Sibling to `findRepliedToGuildMessageId` for a Discord-native reply *within the mod-forum thread
 * itself* (internal chatter replying to another mod-thread message) -- the reply target there is
 * already the mod-thread copy, so this matches on `guild_message_id` directly instead of resolving
 * from the user-thread side. The target can be any prior row in the thread (a relayed user message, a
 * `/reply` log copy, or another internal message) -- all three share the same `thread_messages` shape.
 */
export async function findRepliedToByModMessageId(
	threadId: Threads['id'],
	guildMessageId: string,
): Promise<ThreadMessagesId | undefined> {
	const [row] = await getContext().db<[{ id: ThreadMessagesId }]>`
		SELECT id FROM thread_messages WHERE thread_id = ${threadId} AND guild_message_id = ${guildMessageId}
	`;

	return row?.id;
}

/**
 * Gates whether `relay.ts` records full message content into `thread_message_content` for a guild --
 * consent is opt-in (see `guild_settings.record_thread_content`, #261), so this is checked once per
 * relay call rather than assumed.
 */
export async function isRecordingEnabled(guildId: string): Promise<boolean> {
	const [row] = await getContext().db<[{ recordThreadContent: boolean }]>`
		SELECT record_thread_content FROM guild_settings WHERE guild_id = ${guildId}
	`;

	return row?.recordThreadContent ?? false;
}

/**
 * Looked up by `/edit` and `/delete` to resolve the `Reply ID: N` a mod typed to the row it refers to.
 * `staff_id IS NOT NULL` excludes user messages -- they share the same per-thread numbering space but
 * were never given a `Reply ID:` footer (see `relay.ts`), so mods have no way to reference them this
 * way in the first place. `NOT is_internal` further excludes internal mod-thread chatter (#261) -- also
 * staff-authored, but never given a `Reply ID:` footer either (nothing was relayed anywhere for it to
 * reference), so it's excluded the same way user messages are. The combination of both guarantees a
 * matched row always has a real `user_message_id` -- only a `/reply`/`/reply-q`-relayed row can be both
 * staff-authored and non-internal -- which the return type narrows to so callers don't need their own
 * null check on a column that's `NULL`-able in general (internal rows) but never for what this
 * specifically selects.
 */
export async function findStaffReplyByLocalId(
	threadId: Threads['id'],
	localThreadMessageId: number,
): Promise<(ThreadMessages & { userMessageId: string }) | undefined> {
	const [row] = await getContext().db<ThreadMessages[]>`
		SELECT * FROM thread_messages
		WHERE thread_id = ${threadId} AND local_thread_message_id = ${localThreadMessageId}
			AND staff_id IS NOT NULL AND NOT is_internal
	`;

	return row as (ThreadMessages & { userMessageId: string }) | undefined;
}

/**
 * Overwrites a recorded message's content in place when its author edits it (`lib/userMessageLifecycle.ts`,
 * both the user-thread and internal-mod-chatter handlers) -- a no-op if no `thread_message_content` row
 * exists for this message (predates recording, or recording was never enabled), since there's nothing to
 * reconcile in that case.
 *
 * Phase 3 (#261): before overwriting, the *current* content is archived into `thread_message_content_edits`
 * (mirrors `services/api`'s `updateSnippet.ts` archive-then-overwrite pattern for `snippet_updates`) --
 * but only when the content actually changed, so a no-op "edit" (Discord re-sending the same content, e.g.
 * a link-unfurl backfill that still passed `handleUserMessageUpdate`'s guards) doesn't mint a spurious
 * version. Locks the row (`FOR UPDATE`) for the duration so a burst of rapid edits can't interleave their
 * archive-then-overwrite steps and drop a version.
 *
 * Also a no-op if the guild's `record_thread_content` consent has since been turned back off -- checked
 * atomically in the same `SELECT ... FOR UPDATE` (an `EXISTS` against the row's *current* guild_settings
 * state) rather than a preceding `isRecordingEnabled` call-and-branch, so a disable that races a concurrent
 * edit can't leave a stale write behind. Consent being off should mean *no* further writes touch recorded
 * content at all, not just that new messages stop being recorded -- an existing row surviving a disable
 * (per the "not reset back to null" audit-trail decision) is not license to keep mutating it afterward.
 */
export async function updateRecordedMessageContent(
	guildId: string,
	threadMessageId: ThreadMessagesId,
	text: string,
): Promise<void> {
	await getContext().db.begin(async (tx) => {
		const [current] = await tx<ThreadMessageContent[]>`
			SELECT * FROM thread_message_content
			WHERE thread_message_id = ${threadMessageId}
				AND EXISTS (
					SELECT 1 FROM guild_settings WHERE guild_id = ${guildId} AND record_thread_content = true
				)
			FOR UPDATE
		`;

		if (!current) {
			return;
		}

		if (current.content !== text) {
			await tx`
				INSERT INTO thread_message_content_edits (thread_message_id, old_content)
				VALUES (${threadMessageId}, ${current.content})
			`;
		}

		await tx`
			UPDATE thread_message_content SET content = ${text} WHERE thread_message_id = ${threadMessageId}
		`;
	});
}

/**
 * Sets a user-side recorded message's `deleted_at` when the user deletes it client-side
 * (`lib/userMessageLifecycle.ts`'s `handleUserMessageDelete`) -- display-only (Phase 3, #261): unlike the
 * edit path above, nothing about `thread_message_content` itself is touched, since the "recorded copy
 * survives a delete" decision means there's no content change to reconcile, just a fact to mark. A no-op
 * if already set (idempotent against a duplicate `MESSAGE_DELETE`, or the lifecycle handler retrying after
 * a partial failure).
 */
export async function markUserThreadMessageDeleted(threadMessageId: ThreadMessagesId): Promise<void> {
	await getContext().db`
		UPDATE thread_messages SET deleted_at = now() WHERE id = ${threadMessageId} AND deleted_at IS NULL
	`;
}

/**
 * Looked up by the `MessageUpdate`/`MessageDelete` relay handlers to resolve a raw Discord message
 * id (all a `MESSAGE_DELETE` payload ever carries -- no local numbering, no author) back to its
 * `thread_messages` row. `staff_id IS NULL` scopes this to the user's own messages specifically --
 * a relayed staff-reply copy also lives in the same private thread, but that's `/edit`/`/delete`'s
 * territory (`findStaffReplyByLocalId` above), not this one's.
 */
export async function findUserThreadMessageByMessageId(
	threadId: Threads['id'],
	userMessageId: string,
): Promise<ThreadMessages | undefined> {
	const [row] = await getContext().db<ThreadMessages[]>`
		SELECT * FROM thread_messages
		WHERE thread_id = ${threadId} AND user_message_id = ${userMessageId} AND staff_id IS NULL
	`;

	return row;
}

/**
 * Sibling to `findUserThreadMessageByMessageId` for the mod-thread side of #261's Phase 3 edit/delete
 * capture -- an internal mod-to-mod message has no `user_message_id` to match on (see schema.sql), so this
 * matches on `guild_message_id` (the raw id of the plain message posted directly in the mod-forum thread)
 * scoped to `is_internal = true`, which also excludes `/reply`/`/reply-q` log copies (staff-authored but
 * never internal) the same way `findStaffReplyByLocalId` excludes them from its own territory.
 */
export async function findModThreadMessageByMessageId(
	threadId: Threads['id'],
	guildMessageId: string,
): Promise<ThreadMessages | undefined> {
	const [row] = await getContext().db<ThreadMessages[]>`
		SELECT * FROM thread_messages
		WHERE thread_id = ${threadId} AND guild_message_id = ${guildMessageId} AND is_internal
	`;

	return row;
}

/**
 * True-deletes an internal mod-thread message row when a mod deletes their own plain message via Discord's
 * own UI (Phase 3, #261) -- deliberately asymmetric with the "deleted messages survive" rule for
 * user-facing messages (see the Decisions entry in docs/roadmap/07-modmail-thread-history.md): internal
 * chatter isn't part of the durable user-facing record, so there's nothing worth keeping a "deleted but
 * still readable" trace of. Cascades to the row's own `thread_message_content` (`ON DELETE CASCADE`); any
 * other message that had replied to it survives with `replied_to_thread_message_id` cleared to `NULL`
 * (`ON DELETE SET NULL`) rather than also being deleted. Returns whether a row was actually deleted, purely
 * so the caller can decide whether it's worth logging.
 */
export async function deleteInternalThreadMessage(threadId: Threads['id'], guildMessageId: string): Promise<boolean> {
	const rows = await getContext().db<{ id: ThreadMessagesId }[]>`
		DELETE FROM thread_messages
		WHERE thread_id = ${threadId} AND guild_message_id = ${guildMessageId} AND is_internal
		RETURNING id
	`;

	return rows.length > 0;
}

/**
 * Matches `thread_message_content.attachments`' documented JSONB shape (see schema.sql).
 */
export interface RecordedAttachment {
	contentType: string | null;
	filename: string;
	size: number;
	url: string;
}

/**
 * Matches `thread_message_content.stickers`' documented JSONB shape (see schema.sql).
 */
export interface RecordedSticker {
	formatType: number;
	id: string;
	name: string;
}

/**
 * Populated by `relay.ts` only when `isRecordingEnabled` is true for the guild -- `insertThreadMessage`
 * wraps the `thread_messages` insert and this sidecar insert in one transaction when present, and skips
 * `thread_message_content` entirely when absent (the "predates recording" case, see schema.sql).
 */
export interface InsertThreadMessageContentOptions {
	attachments: RecordedAttachment[];
	isForwarded: boolean;
	repliedToThreadMessageId: ThreadMessagesId | null;
	stickers: RecordedSticker[];
	text: string;
}

export interface InsertThreadMessageOptions {
	anon: boolean;
	content?: InsertThreadMessageContentOptions | undefined;
	guildId: string;
	guildMessageId: string;
	/**
	 * True for mod-to-mod chatter posted directly in the mod-forum thread -- never crosses to the user's
	 * private thread, so `userMessageId` is `null` for these (see schema.sql).
	 */
	isInternal?: boolean | undefined;
	/**
	 * True for the bot's own automated greeting/farewell messages -- see schema.sql's doc comment on why
	 * this needs to be its own flag rather than inferred from `staffId`/`userId`.
	 */
	isSystem?: boolean | undefined;
	localThreadMessageId: number;
	staffId: string | null;
	threadId: Threads['id'];
	userId: string;
	userMessageId: string | null;
}

export async function insertThreadMessage({
	anon,
	content,
	guildId,
	guildMessageId,
	isInternal = false,
	isSystem = false,
	localThreadMessageId,
	staffId,
	threadId,
	userId,
	userMessageId,
}: InsertThreadMessageOptions): Promise<void> {
	const db = getContext().db;

	if (!content) {
		await db`
			INSERT INTO thread_messages (
				local_thread_message_id, guild_id, thread_id, user_id, user_message_id, staff_id, guild_message_id, anon,
				is_internal, is_system
			) VALUES (
				${localThreadMessageId}, ${guildId}, ${threadId}, ${userId}, ${userMessageId}, ${staffId}, ${guildMessageId}, ${anon},
				${isInternal}, ${isSystem}
			)
		`;
		return;
	}

	await db.begin(async (tx) => {
		const [row] = await tx<[{ id: ThreadMessagesId }]>`
			INSERT INTO thread_messages (
				local_thread_message_id, guild_id, thread_id, user_id, user_message_id, staff_id, guild_message_id, anon,
				is_internal, is_system
			) VALUES (
				${localThreadMessageId}, ${guildId}, ${threadId}, ${userId}, ${userMessageId}, ${staffId}, ${guildMessageId}, ${anon},
				${isInternal}, ${isSystem}
			)
			RETURNING id
		`;

		// Must go through `sql.json()`, not `${JSON.stringify(x)}::jsonb` -- the latter binds the value as an
		// untyped (oid 0) parameter, and postgres.js/Postgres resolve that combination by wrapping the
		// already-stringified text in a second layer of JSON encoding (`to_jsonb(text)` semantics) instead of
		// parsing it, so the column ends up holding a JSON *string* containing escaped JSON rather than a real
		// array (reproduced in isolation against a temp table when this was debugged). `sql.json()` binds the
		// value with the correct json oid up front, so postgres.js's own serializer only stringifies once.
		// `RecordedAttachment[]`/`RecordedSticker[]` (plain interfaces, no index signature) aren't structurally
		// assignable to `JSONValue` -- narrowed through `unknown` rather than fighting that, they're already
		// JSON-safe by construction.
		await tx`
			INSERT INTO thread_message_content (
				thread_message_id, content, replied_to_thread_message_id, is_forwarded, attachments, stickers
			) VALUES (
				${row!.id}, ${content.text}, ${content.repliedToThreadMessageId}, ${content.isForwarded},
				${tx.json(content.attachments as unknown as postgres.JSONValue)},
				${tx.json(content.stickers as unknown as postgres.JSONValue)}
			)
		`;
	});
}
