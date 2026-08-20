import { createHash } from 'node:crypto';
import { getContext } from '@chatsift/backend-core';
import type { GatewayAutoModerationActionExecutionDispatchData } from '@discordjs/core';

/**
 * Collapses the **action fan-out** on `AUTO_MODERATION_ACTION_EXECUTION` (P5a).
 *
 * Discord dispatches this event once per *executed action*, not once per trigger -- `action` is singular, and
 * `alert_system_message_id` is documented as present only on the event "corresponding to an action with type
 * SendAlertMessage". So a rule configured to block **and** time out **and** alert, which is an ordinary
 * configuration, fires three events carrying the same `rule_id`, `user_id` and `matched_keyword`. Without this,
 * one message produces three punishments, three cases, three filter-log embeds and three reports.
 *
 * Why this exists *alongside* the `idempotencyKey` on the case row rather than instead of it -- they cover
 * different failures and neither subsumes the other:
 *
 * - The case key is permanent and keyed on `message_id`, so it protects against a gateway *redelivery* days
 *   apart. It cannot help here, because a **blocked** message has no `message_id` at all (Discord suppressed it
 *   before it existed), which is precisely the configuration that fans out the most.
 * - This one is keyed on the content when there is no message id, and therefore **must** be short-lived: the
 *   same text posted again an hour later is a new offence and has to be punished again. A permanent key on a
 *   content hash would silence a repeat offender forever.
 *
 * The consequence to accept, stated plainly: the *same* text from the *same* member caught by the *same* rule
 * twice inside the short window below counts once. That is somebody spamming an already-blocked message, where
 * one punishment is the answer anyone would want, and it is a far smaller cost than triple-punishing every
 * multi-action rule.
 */

/**
 * Long enough to cover a fan-out arriving over a briefly congested gateway, short enough that it cannot be
 * mistaken for deduplication of a genuine repeat offence.
 */
export const DEDUPE_TTL_MS = 15_000;

/**
 * What distinguishes one trigger from the next.
 *
 * `message_id` when Discord sends one, which is exact. Otherwise a hash of the content, which is the only thing
 * left that varies per message -- and is hashed rather than used raw because this is a redis key, and a redis
 * key holding somebody's message text verbatim is a copy of it we did not need to keep.
 *
 * `content` is empty without the MessageContent intent, so `matched_content` is the fallback and a fixed
 * sentinel is the last resort. In that final case the key degenerates to "this member tripped this rule", which
 * still collapses the fan-out correctly -- it only widens what else it collapses.
 */
function triggerIdentity(data: GatewayAutoModerationActionExecutionDispatchData): string {
	if (data.message_id) {
		return `m:${data.message_id}`;
	}

	// Not `??`: `content` is a non-nullable string that is *empty* without the MessageContent intent, and empty
	// is exactly the case that has to fall through to the next candidate.
	const text = data.content.length > 0 ? data.content : (data.matched_content ?? '');
	if (text.length === 0) {
		return 'x';
	}

	return `c:${createHash('sha256').update(text).digest('base64url').slice(0, 22)}`;
}

/**
 * True when this event is the first one seen for its trigger, and therefore the one that should be responded
 * to. False means another action of the same rule already claimed it.
 *
 * `SET NX PX` -- one round trip, atomic, so two events racing on one replica cannot both win. Sharding already
 * guarantees a guild's events reach a single replica, so this needs no stronger coordination than that.
 *
 * **Fails open.** A redis outage lets every event through, which over-punishes on multi-action rules; the
 * alternative fails closed and silently disables banword enforcement for as long as redis is down. Between
 * "moderation happens twice" and "moderation stops", the first is the recoverable one.
 */
export async function claimAutomodExecution(
	data: GatewayAutoModerationActionExecutionDispatchData,
): Promise<boolean> {
	const key = `automoderator:automod-exec:${data.guild_id}:${data.rule_id}:${data.user_id}:${triggerIdentity(data)}`;

	try {
		const claimed = await getContext().redis.set(key, '1', { NX: true, PX: DEDUPE_TTL_MS });
		return claimed !== null;
	} catch (error) {
		getContext().logger.warn(
			{ err: error, guildId: data.guild_id, ruleId: data.rule_id },
			'could not deduplicate an AutoMod execution -- a multi-action rule may respond more than once',
		);
		return true;
	}
}
