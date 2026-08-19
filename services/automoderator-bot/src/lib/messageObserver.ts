import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { fetchUser } from '@chatsift/bot-core';
import { formatCaseUserTag } from '@chatsift/core';
import type { Client, GatewayMessageDeleteDispatchData, GatewayMessageUpdateDispatchData } from '@discordjs/core';
import { GatewayDispatchEvents } from '@discordjs/core';
import { traceDecision } from './decisionTrace.js';
import { ATTRIBUTION_GRACE_MS, findDeleteModerator } from './deleteAttribution.js';
import { dispatchLog, getLogWebhook, LOG_TYPE } from './guildLog.js';
import type { LogActor } from './guildLogFormat.js';
import { buildMessageDeleteEmbed, buildMessageEditEmbed } from './guildLogFormat.js';
import { findLogExemption } from './logExemptions.js';
import type { CachedMessage } from './messageCache.js';
import { cacheMessage, dropCachedMessage, getCachedMessage, isLoggableMessage } from './messageCache.js';
import { featureInvocations } from './metrics.js';

/**
 * The message log (P4, feature 34): edits and deletes, with what the message used to say.
 *
 * Everything here depends on the `GuildMessages` and `MessageContent` intents. Without the second one every
 * message caches with empty text and the log renders nothing while looking perfectly healthy -- see
 * `automoderator_message_cache_lookups_total` in `metrics.ts`, which is the only thing that says so.
 */
const FEATURE = 'message_log';

function actorFromCached(cached: CachedMessage): LogActor {
	return { id: cached.authorId, tag: cached.authorTag, avatar: cached.authorAvatar };
}

export function registerMessageObserver(client: Client): void {
	// Every listener catches its own: a rejected one is re-emitted as an `'error'` event by `@discordjs/core`,
	// which is the convention the rest of this service already follows.
	client.on(GatewayDispatchEvents.MessageCreate, async ({ data }) => {
		try {
			await cacheMessage(data);
		} catch (error) {
			getContext().logger.error({ err: error, messageId: data.id }, 'failed to cache a message');
		}
	});

	client.on(GatewayDispatchEvents.MessageUpdate, async ({ data }) => {
		const logger = getContext().logger.child({ event: 'messageUpdate', guildId: data.guild_id });

		try {
			await handleMessageUpdate(data, logger);
		} catch (error) {
			featureInvocations.inc({ feature: FEATURE, outcome: 'failed' });
			logger.error({ err: error, messageId: data.id }, 'failed to log a message edit');
		}
	});

	client.on(GatewayDispatchEvents.MessageDelete, async ({ data }) => {
		const logger = getContext().logger.child({ event: 'messageDelete', guildId: data.guild_id });

		try {
			await handleMessageDelete(data, logger);
		} catch (error) {
			featureInvocations.inc({ feature: FEATURE, outcome: 'failed' });
			logger.error({ err: error, messageId: data.id }, 'failed to log a message deletion');
		}
	});
}

async function handleMessageUpdate(data: GatewayMessageUpdateDispatchData, logger: Logger): Promise<void> {
	// Narrows `data` for the rest of this function as well as gating the cache write -- a reduced payload is
	// refused rather than diffed against, since diffing missing content against the cached text would post an
	// edit whose "After" is empty. See `CacheableMessage`.
	if (!isLoggableMessage(data)) {
		return;
	}

	const before = await getCachedMessage(data.id);

	// Re-cached unconditionally, and *before* the early returns below: the next edit has to diff against the
	// newest text even when this one was exempt or unlogged, or the log would eventually claim a two-edit-old
	// version was the previous one.
	await cacheMessage(data);

	if (!before) {
		featureInvocations.inc({ feature: FEATURE, outcome: 'skipped' });
		return;
	}

	// `MESSAGE_UPDATE` fires for things that are not edits at all -- Discord unfurling a link into an embed,
	// a pin, an attachment finishing upload. Only a content change is worth a log line, and legacy filtered
	// here for the same reason.
	if (before.content === data.content) {
		return;
	}

	// Before the exemption query and everything after it: a guild with no message log is the default state and
	// by far the common one, and there is nothing to decide for it. Deliberately uncounted -- a server that
	// never asked for this feature is not "skipping" it.
	const webhook = await getLogWebhook(data.guild_id, LOG_TYPE.MESSAGE);
	if (!webhook) {
		return;
	}

	const exemption = await findLogExemption(data.guild_id, data.channel_id);
	if (exemption) {
		traceDecision(logger, {
			runner: FEATURE,
			action: null,
			guildId: data.guild_id,
			targetId: before.authorId,
			exemption,
		});
		featureInvocations.inc({ feature: FEATURE, outcome: 'skipped' });
		return;
	}

	await dispatchLog(
		webhook,
		{
			source: 'observer',
			embeds: [
				buildMessageEditEmbed({
					author: actorFromCached(before),
					guildId: data.guild_id,
					channelId: data.channel_id,
					messageId: data.id,
					before: before.content,
					after: data.content,
				}),
			],
		},
		logger,
	);

	featureInvocations.inc({ feature: FEATURE, outcome: 'applied' });
}

async function handleMessageDelete(data: GatewayMessageDeleteDispatchData, logger: Logger): Promise<void> {
	if (!data.guild_id) {
		return;
	}

	const message = await getCachedMessage(data.id);
	if (!message) {
		// Nothing to say. A delete of something never cached (posted before the bot joined, past the retention
		// window, or by a bot) is genuinely unloggable rather than an error -- but a *sustained* run of these is
		// how a missing `MessageContent` intent presents, which is what the cache-lookup counter is for.
		featureInvocations.inc({ feature: FEATURE, outcome: 'skipped' });
		return;
	}

	await dropCachedMessage(data.id);

	// See the same check in `handleMessageUpdate`: this is what keeps a guild with no message log from paying
	// for an exemption query, a 1.5s wait and a user lookup on every single deletion.
	const webhook = await getLogWebhook(data.guild_id, LOG_TYPE.MESSAGE);
	if (!webhook) {
		return;
	}

	const exemption = await findLogExemption(data.guild_id, data.channel_id);
	if (exemption) {
		traceDecision(logger, {
			runner: FEATURE,
			action: null,
			guildId: data.guild_id,
			targetId: message.authorId,
			exemption,
		});
		featureInvocations.inc({ feature: FEATURE, outcome: 'skipped' });
		return;
	}

	// The audit entry explaining this delete comes over the same gateway connection and can land either side of
	// the delete itself, so the log waits a moment rather than racing it. See `deleteAttribution.ts` for why
	// this is a buffered gateway signal and not the per-delete audit-log fetch legacy issued.
	await sleep(ATTRIBUTION_GRACE_MS);
	const moderatorId = findDeleteModerator(data.guild_id, data.channel_id, message.authorId);

	let moderator: LogActor | null = null;
	if (moderatorId) {
		// `.catch(() => null)`, matching `ama-bot`'s `markDuplicateSelect.ts`: `fetchUser` rethrows anything that
		// isn't a 404, and by this point `dropCachedMessage` has already destroyed the only copy of the deleted
		// message. Letting a restarting proxy or a 5xx on the (heavily contended) `GET /users/{id}` bucket escape
		// would take the whole log entry down with it, permanently, for the sake of a name. The row below already
		// knows how to render an unresolvable moderator, so degrading to that is the smaller loss.
		const user = await fetchUser(getContext().service.client.api, moderatorId).catch(() => null);
		moderator = {
			id: moderatorId,
			tag: user ? formatCaseUserTag(user) : 'Unknown User',
			avatar: user?.avatar ?? null,
		};
	}

	await dispatchLog(
		webhook,
		{
			source: 'observer',
			embeds: [
				buildMessageDeleteEmbed({
					author: actorFromCached(message),
					channelId: data.channel_id,
					messageId: data.id,
					content: message.content,
					attachmentCount: message.attachmentCount,
					moderator,
				}),
			],
		},
		logger,
	);

	featureInvocations.inc({ feature: FEATURE, outcome: 'applied' });
}
