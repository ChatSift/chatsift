import { randomUUID } from 'node:crypto';
import { getContext } from '../context.js';
import type { ReportActor, ReportContextMessage } from './automoderatorReports.js';

/**
 * DM report drafts (P3b).
 *
 * Someone harassed in a DM has no guild context to report from, so the flow is: a user-installed message
 * context menu appends Discord's *own* copy of a message to a draft here, `/submit-report` mints a token, and
 * the website resolves that token after an OAuth login to ask which shared server the report is for.
 *
 * Redis rather than a table because a draft is a half-finished thought, not a record -- it expires on its own,
 * nothing ever queries across drafts, and the only durable artifact is the report the reporter confirms.
 */

/**
 * How long a draft survives without being touched. Renewed by every message added to it and by minting a
 * token, so the clock a reporter actually experiences starts at their last action rather than their first.
 */
const DRAFT_TTL_MS = 30 * 60 * 1_000;

/**
 * Deliberately shorter than the draft. The token is the part that travels through a URL, a browser and an
 * OAuth round trip, and the reporter can always mint another from the same draft.
 */
const TOKEN_TTL_MS = 10 * 60 * 1_000;

/**
 * Surfaced so the bot's ephemeral replies can state the deadline without restating the number.
 */
export const REPORT_DRAFT_TTL_MINUTES = DRAFT_TTL_MS / 60_000;
export const REPORT_DRAFT_TOKEN_TTL_MINUTES = TOKEN_TTL_MS / 60_000;

/**
 * The subject message plus at most this many context messages, which is what keeps the card inside Discord's
 * 6000-character-per-message embed budget once every message is rendered with its own author and image.
 */
export const REPORT_DRAFT_MAX_MESSAGES = 6;

const draftKey = (userId: string): string => `automoderator:reportdraft:${userId}`;
const tokenKey = (token: string): string => `automoderator:reporttoken:${token}`;

/**
 * One captured message. Mirrors `ReportContextMessage` plus the timestamp, which the card renders and the
 * website previews -- a draft is read back out of order often enough that deriving it from the snowflake at
 * every surface isn't worth it.
 */
export interface ReportDraftMessage {
	readonly author: ReportActor;
	readonly channelId: string;
	readonly content: string | null;
	readonly imageUrl: string | null;
	readonly messageId: string;
	readonly timestamp: string;
}

export interface ReportDraft {
	/**
	 * In the order the reporter added them, which is the order the card renders. Never re-sorted
	 * chronologically -- which message they lead with is part of what they are saying.
	 */
	readonly messages: readonly ReportDraftMessage[];
}

/**
 * Why a message could not be added to a draft. A closed set for the same reason `ReportRefusal` is one.
 */
export type DraftAddRefusal = 'duplicate' | 'full';

export interface AddDraftMessageResult {
	readonly draft: ReportDraft;
	/**
	 * `null` when the message was added. Otherwise the draft is returned unchanged and this says why.
	 */
	readonly refusal: DraftAddRefusal | null;
}

export async function getReportDraft(userId: string): Promise<ReportDraft | null> {
	const raw = await getContext().redis.get(draftKey(userId));
	if (!raw) {
		return null;
	}

	return JSON.parse(raw.toString()) as ReportDraft;
}

export async function clearReportDraft(userId: string): Promise<void> {
	await getContext().redis.del(draftKey(userId));
}

/**
 * Appends a message to this reporter's draft, creating it if there isn't one.
 *
 * Read-modify-write without a lock, deliberately: the only writer is the reporter's own context menu, and
 * Discord's interaction model means they are clicking one menu at a time. The cost of losing a race here is
 * one message not landing in a draft they are still building, which they can see and redo.
 */
export async function addReportDraftMessage(
	userId: string,
	message: ReportDraftMessage,
): Promise<AddDraftMessageResult> {
	const existing = await getReportDraft(userId);
	const messages = existing?.messages ?? [];

	if (messages.some((candidate) => candidate.messageId === message.messageId)) {
		return { draft: { messages }, refusal: 'duplicate' };
	}

	if (messages.length >= REPORT_DRAFT_MAX_MESSAGES) {
		return { draft: { messages }, refusal: 'full' };
	}

	const draft: ReportDraft = { messages: [...messages, message] };

	await getContext().redis.set(draftKey(userId), JSON.stringify(draft), {
		expiration: { type: 'PX', value: DRAFT_TTL_MS },
	});

	return { draft, refusal: null };
}

/**
 * What a draft token names.
 *
 * **Not a bearer credential**, unlike `automoderatorHistoryTokens.ts` -- the resemblance is the trap. That one
 * grants a view of somebody's own case history, which is harmless to whoever holds the link. This one names
 * private DM content, so the route that redeems it re-checks `userId` against the logged-in session *after*
 * OAuth and refuses if they differ. The token alone gets you nothing.
 */
export interface ReportDraftToken {
	readonly userId: string;
}

/**
 * Mints a token naming the caller's current draft, and renews the draft so it cannot expire out from under the
 * link that was just handed out.
 */
export async function mintReportDraftToken(userId: string): Promise<string> {
	const token = randomUUID();
	const redis = getContext().redis;

	await Promise.all([
		redis.set(tokenKey(token), JSON.stringify({ userId } satisfies ReportDraftToken), {
			expiration: { type: 'PX', value: TOKEN_TTL_MS },
		}),
		redis.pExpire(draftKey(userId), DRAFT_TTL_MS),
	]);

	return token;
}

export async function resolveReportDraftToken(token: string): Promise<ReportDraftToken | null> {
	const raw = await getContext().redis.get(tokenKey(token));
	if (!raw) {
		return null;
	}

	return JSON.parse(raw.toString()) as ReportDraftToken;
}

/**
 * Burns a token once its draft has been filed, so a confirmed report can't be filed twice into a second guild
 * from the same link. The draft itself is cleared separately -- see the submission route for why the two are
 * not one call.
 */
export async function consumeReportDraftToken(token: string): Promise<void> {
	await getContext().redis.del(tokenKey(token));
}

/**
 * A draft split into the shape `automoderator_reports` stores.
 *
 * The subject is the first message in the draft **authored by the target**, not simply the first message: the
 * parent row's `target_id`/`target_tag` describe whoever wrote the snapshot on it, and the card renders that
 * pairing as its author line. A draft that opened with the reporter's own reply would otherwise produce a
 * report whose headline message was written by the person filing it.
 */
export interface SplitDraft {
	readonly contextMessages: readonly ReportContextMessage[];
	readonly subject: ReportDraftMessage;
	readonly target: ReportActor;
}

/**
 * Works out who a draft is *about* and which message leads it.
 *
 * Returns `null` when every message was written by the reporter -- which is not a malformed draft so much as
 * somebody who added only their own side of a conversation, and there is nobody to report.
 */
export function splitDraft(draft: ReportDraft, reporterId: string): SplitDraft | null {
	const subject = draft.messages.find((message) => message.author.id !== reporterId);
	if (!subject) {
		return null;
	}

	return {
		target: subject.author,
		subject,
		// Everything else, in the order the reporter chose -- including their own replies, and including the
		// target's other messages. Only the one message promoted to the parent row is removed.
		contextMessages: draft.messages
			.filter((message) => message.messageId !== subject.messageId)
			.map((message) => ({
				messageId: message.messageId,
				channelId: message.channelId,
				content: message.content,
				imageUrl: message.imageUrl,
				author: message.author,
			})),
	};
}
