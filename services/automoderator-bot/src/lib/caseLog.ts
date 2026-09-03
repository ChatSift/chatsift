import type { Logger } from '@chatsift/backend-core';
import { decrypt, getContext } from '@chatsift/backend-core';
import { formatCaseNumber, logJumpChannelId } from '@chatsift/core';
import type { AutomoderatorCases, AutomoderatorLogWebhooks } from '@chatsift/db';
import type { APIMessage } from '@discordjs/core';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import type { ActionSource } from './actionExecutor.js';
import { executeAction } from './actionExecutor.js';
import { resolveAvatarURL } from './avatars.js';
import { buildCaseEmbed } from './caseFormat.js';
import { updateCase } from './cases.js';
import { forgetLogWebhook, getLogWebhook, LOG_TYPE, logAvatarUrl } from './guildLog.js';
import { logDispatch } from './metrics.js';

/**
 * The mod log keeps its own dispatcher rather than going through `guildLog.ts`'s: a case *rewrites* the message
 * it already posted when it is amended or pardoned, which needs the case row to carry `log_message_id` and
 * needs `wait: true` on the first post to learn it. Every other log is fire-and-forget.
 */
export async function getModLogWebhook(guildId: string): Promise<AutomoderatorLogWebhooks | null> {
	return getLogWebhook(guildId, LOG_TYPE.MOD);
}

/**
 * `#12`, hyperlinked to the case's own mod-log message when there is one (#381), for a caller holding nothing
 * but the row.
 *
 * Pays for an `automoderator_log_webhooks` lookup, so it is the fallback rather than the default: anything that
 * has just dispatched a log already has the answer in {@link CaseLogResult.jumpChannelId} and should render
 * with `formatCaseNumber` instead. Short-circuits on a case that never made it into a log, which costs nothing
 * and is the common case for a guild with no mod log at all.
 */
export async function formatCaseRef(
	modCase: Pick<AutomoderatorCases, 'caseId' | 'guildId' | 'logMessageId'>,
): Promise<string> {
	if (!modCase.logMessageId) {
		return formatCaseNumber(modCase.caseId);
	}

	const webhook = await getModLogWebhook(modCase.guildId);

	return formatCaseNumber(modCase.caseId, {
		guildId: modCase.guildId,
		logChannelId: logJumpChannelId(webhook),
		logMessageId: modCase.logMessageId,
	});
}

/**
 * Everything a caller needs to name the case it just logged.
 *
 * Both halves are things only this function knows: `log_message_id` is discovered by the post itself (the row
 * the caller is holding predates it), and `jumpChannelId` comes off the webhook row this already had to read.
 * Handing back the second is what keeps the reply from paying for the same `automoderator_log_webhooks` lookup
 * a second time -- see {@link formatCaseRef}, which is the variant for callers that hold no webhook.
 */
export interface CaseLogResult {
	/**
	 * The case as it stands afterwards -- the same row, plus whatever the dispatch wrote to it.
	 */
	readonly case: AutomoderatorCases;
	/**
	 * Where a jump link to this case's log message points, or null when the guild has no mod log.
	 */
	readonly jumpChannelId: string | null;
}

/**
 * Posts the case's mod-log embed, or rewrites the one it already has.
 */
export async function dispatchCaseLog(
	modCase: AutomoderatorCases,
	logger: Logger,
	source: ActionSource = 'command',
): Promise<CaseLogResult> {
	const webhook = await getModLogWebhook(modCase.guildId);
	if (!webhook) {
		return { case: modCase, jumpChannelId: null };
	}

	const jumpChannelId = logJumpChannelId(webhook);

	const [reference] =
		modCase.refId === null
			? []
			: await getContext().db<AutomoderatorCases[]>`
					SELECT * FROM automoderator_cases
					WHERE guild_id = ${modCase.guildId} AND case_id = ${modCase.refId}
				`;

	const api = getContext().service.client.api;
	const targetAvatarURL = await resolveAvatarURL(api, modCase.targetId, logger);

	const embed = buildCaseEmbed(modCase, {
		reference: reference ?? null,
		logChannelId: jumpChannelId,
		...(targetAvatarURL ? { targetAvatarURL } : {}),
	});

	try {
		const token = decrypt(webhook.webhookToken);

		let posted: APIMessage | undefined;

		await executeAction(
			{
				action: 'webhook',
				guildId: modCase.guildId,
				source,
				targetId: modCase.targetId,
				async execute() {
					if (modCase.logMessageId) {
						await api.webhooks.editMessage(webhook.webhookId, token, modCase.logMessageId, {
							embeds: [embed],
							...(webhook.threadId ? { thread_id: webhook.threadId } : {}),
						});
					} else {
						posted = await api.webhooks.execute(webhook.webhookId, token, {
							embeds: [embed],
							avatar_url: logAvatarUrl(LOG_TYPE.MOD),
							wait: true,
							...(webhook.threadId ? { thread_id: webhook.threadId } : {}),
						});
					}
				},
			},
			logger,
		);

		logDispatch.inc({ log_type: 'MOD', result: 'ok' });

		return {
			case: posted ? await updateCase(modCase.id, { logMessageId: posted.id }) : modCase,
			jumpChannelId,
		};
	} catch (error) {
		logDispatch.inc({ log_type: 'MOD', result: 'failed' });

		if (error instanceof DiscordAPIError) {
			if (error.code === RESTJSONErrorCodes.UnknownMessage) {
				const cleared = await updateCase(modCase.id, { logMessageId: null });
				logger.warn({ guildId: modCase.guildId, caseId: modCase.caseId }, 'mod log message vanished, cleared it');
				return { case: cleared, jumpChannelId };
			}

			if (error.code === RESTJSONErrorCodes.UnknownWebhook) {
				await forgetLogWebhook(modCase.guildId, webhook.logType, webhook.webhookId);
				logger.warn({ guildId: modCase.guildId, webhookId: webhook.webhookId }, 'mod log webhook is gone, dropped it');
				// The webhook row is gone, so there is nothing left to link through even though the message may
				// well still be sitting in the channel.
				return { case: modCase, jumpChannelId: null };
			}
		}

		logger.error({ err: error, guildId: modCase.guildId, caseId: modCase.caseId }, 'failed to dispatch a case log');
		return { case: modCase, jumpChannelId };
	}
}
