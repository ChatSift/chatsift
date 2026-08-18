import { randomUUID } from 'node:crypto';
import type { Recipe } from 'bin-rw';
import { createRecipe, DataType } from 'bin-rw';
import { getContext } from '../context.js';
import { RedisStore } from './_store.js';
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
export type DraftAddRefusal = 'different-channel' | 'duplicate' | 'full';

export interface AddDraftMessageResult {
	readonly draft: ReportDraft;
	/**
	 * `null` when the message was added. Otherwise the draft is returned unchanged and this says why.
	 */
	readonly refusal: DraftAddRefusal | null;
}

/**
 * bin-rw rather than `JSON.stringify`, matching `MeStore` and every other structured value this codebase keeps
 * in redis -- a draft is a nested, versioned shape, which is exactly what the recipe machinery is for. The
 * payoff that matters here is `versioned: true`: when this shape next changes, a draft written by the old code
 * is *evicted* by `RedisStore`'s `decodeOrEvict` rather than parsed into an object whose type is a lie. Plain
 * JSON would hand a half-populated `ReportDraftMessage` straight to the card builder.
 *
 * bin-rw's inferred type is wider than `ReportDraft` -- every `DataType.String` decodes as `string | null`, and
 * a nested blueprint as `... | null` -- whereas `content`/`imageUrl` are the only genuinely nullable fields
 * here. The cast corrects that, the same way `meRecipe` does.
 */
const draftRecipe = createRecipe(
	{
		messages: [
			{
				messageId: DataType.String,
				channelId: DataType.String,
				author: { id: DataType.String, tag: DataType.String },
				content: DataType.String,
				imageUrl: DataType.String,
				timestamp: DataType.String,
			},
		],
	},
	{ versioned: true },
) as Recipe<ReportDraft>;

const DraftStore = new RedisStore<ReportDraft>({
	TTL: DRAFT_TTL_MS,
	recipe: draftRecipe,
	makeKey: (userId: string) => `automoderator:reportdraft:${userId}`,
	// A draft is the reporter's own working state, so somebody looking at it on the confirmation page is by
	// definition still working on it -- sliding the window on read is the behaviour we want, unlike
	// `data/bots.ts`'s liveness leases.
	storeOld: false,
});

export async function getReportDraft(userId: string): Promise<ReportDraft | null> {
	return DraftStore.get(userId);
}

export async function clearReportDraft(userId: string): Promise<void> {
	await DraftStore.delete(userId);
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

	// **A draft is bound to one conversation.** Without this a reporter could take the subject message from
	// their DM with Alice and the "context" from an unrelated DM with Bob, and Bob's private messages would be
	// persisted onto a report about Alice and shown to a guild's staff. Nothing downstream could catch it: the
	// target-membership check only ever sees Alice, and staff have no way to tell the two conversations apart.
	// The reporter is the only party to a DM who can consent to it being disclosed, and they are not a party to
	// the other one.
	if (messages.some((candidate) => candidate.channelId !== message.channelId)) {
		return { draft: { messages }, refusal: 'different-channel' };
	}

	if (messages.length >= REPORT_DRAFT_MAX_MESSAGES) {
		return { draft: { messages }, refusal: 'full' };
	}

	const draft: ReportDraft = { messages: [...messages, message] };
	await DraftStore.set(userId, draft);

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

const tokenRecipe = createRecipe({ userId: DataType.String }, { versioned: true }) as Recipe<ReportDraftToken>;

const TokenStore = new RedisStore<ReportDraftToken>({
	TTL: TOKEN_TTL_MS,
	recipe: tokenRecipe,
	makeKey: tokenKey,
	// Unlike the draft, the ten minutes are an absolute budget rather than an idle timeout: reloading the
	// confirmation page must not keep extending how long the link stays live. The draft behind it is what the
	// reporter is still working on, and that one does slide.
	refreshTTLOnRead: false,
	storeOld: false,
});

/**
 * Mints a token naming the caller's current draft, and renews the draft so it cannot expire out from under the
 * link that was just handed out.
 */
export async function mintReportDraftToken(userId: string): Promise<string> {
	const token = randomUUID();
	await TokenStore.set(token, { userId });

	// Reading the draft slides its TTL (see `DraftStore`), which is exactly the renewal wanted here: the link
	// just handed out must not point at something that expires before the reporter can open it.
	await getReportDraft(userId);

	return token;
}

/**
 * Reads a token **without** consuming it -- the preview page needs to resolve the same token as many times as
 * the reporter reloads it. `claimReportDraftToken` is the one that burns it.
 */
export async function resolveReportDraftToken(token: string): Promise<ReportDraftToken | null> {
	return TokenStore.get(token);
}

/**
 * Claims a token for a submission, atomically. Returns `false` when somebody else already claimed it, which the
 * caller must read as "this draft has already been filed" rather than as an error.
 *
 * `DEL` is the claim because redis executes it atomically and reports how many keys it actually removed, so of
 * two concurrent submissions exactly one sees `1`. Reading the token and deleting it afterwards -- which is what
 * this used to do -- left a window in which both requests resolved the same draft and filed it into *two
 * different guilds*, since `fileReport` dedupes per guild and would happily accept both. One draft is one
 * report; this is what enforces it.
 *
 * Deliberately called only *after* the session check, never before: claiming first would let anyone who guesses
 * a token burn somebody else's link without ever proving who they are.
 */
export async function claimReportDraftToken(token: string): Promise<boolean> {
	// The one operation here that goes to the raw client rather than through `TokenStore`: the store's `delete`
	// returns nothing, and the count is the entire point.
	return (await getContext().redis.del(tokenKey(token))) === 1;
}

/**
 * Puts a claimed token back after the write it was claimed for failed, so a transient database error costs the
 * reporter a retry rather than their whole draft. The remaining TTL is not preserved -- a fresh window is the
 * friendlier failure mode, and the draft it names is what actually bounds the exposure.
 */
export async function releaseReportDraftToken(token: string, userId: string): Promise<void> {
	await TokenStore.set(token, { userId });
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
