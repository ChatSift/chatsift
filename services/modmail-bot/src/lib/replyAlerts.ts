import { getContext } from '@chatsift/backend-core';
import type { Threads } from '@chatsift/db';

/**
 * Debounce window for one ticket's reply-alert pings. Prod ChatSift/ModMail's `/alert` pinged every
 * subscriber on *every* relayed user message — a user sending a burst of short messages in a row (or
 * just typing across several sends) turned into a repeat ping per message per subscriber. This caps it
 * to at most one ping per cooldown window per ticket, reset early the moment a staffer actually
 * replies (`clearReplyAlertCooldown`, called from `relayStaffReplyToUserThread`) so the *next* user
 * message after a reply still pings immediately rather than waiting out a stale cooldown.
 */
const REPLY_ALERT_COOLDOWN_MS = 5 * 60 * 1_000;

function cooldownKey(threadId: Threads['id']): string {
	return `modmail:reply-alert-cooldown:${threadId}`;
}

export async function clearReplyAlertCooldown(threadId: Threads['id']): Promise<void> {
	await getContext().redis.del([cooldownKey(threadId)]);
}

/**
 * Called from `relayUserMessageToModThread` before it posts the relayed message. Staff subscribed to
 * this ticket (`thread_reply_alerts`, toggled via `/alert`) get pinged by having their mentions
 * appended to that same message's plain-text `content` (not the embed — a ping only ever notifies from
 * a message's actual content), unless the cooldown above is still active. Returns `undefined` when
 * there's nothing to ping (no subscribers, or still on cooldown).
 */
export async function resolveReplyAlertMentions(thread: Pick<Threads, 'id'>): Promise<string | undefined> {
	const key = cooldownKey(thread.id);

	// Atomically claims the cooldown with `SET ... NX` instead of a separate `EXISTS` check followed by
	// a later `SET` — two user messages arriving close together could otherwise both pass the `EXISTS`
	// check before either one's `SET` lands, and both would ping. `NX` makes only one of them ever
	// actually acquire the key.
	const claimed = await getContext().redis.set(key, '1', {
		condition: 'NX',
		expiration: { type: 'PX', value: REPLY_ALERT_COOLDOWN_MS },
	});

	if (claimed === null) {
		return undefined;
	}

	const subscribers = await getContext().db<{ userId: string }[]>`
		SELECT user_id FROM thread_reply_alerts WHERE thread_id = ${thread.id}
	`;

	if (subscribers.length === 0) {
		// Nothing to ping — release the cooldown we just claimed so it doesn't needlessly block the next
		// message from pinging once someone actually subscribes.
		await getContext().redis.del([key]);
		return undefined;
	}

	return subscribers.map(({ userId }) => `<@${userId}>`).join(' ');
}
