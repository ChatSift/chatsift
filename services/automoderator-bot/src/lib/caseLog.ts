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
import { forgetLogWebhook, getLogWebhook, LOG_TYPE } from './guildLog.js';
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
 * `#12`, hyperlinked to the case's own mod-log message when there is one (#381).
 *
 * A lookup rather than pure formatting because the link needs the *mod* log's channel and every surface that
 * names a case number is somewhere else -- a command reply, the filter log. Short-circuits on a case that never
 * made it into a log, which is both the cheap answer and the common one for a guild with no mod log at all.
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
 * Posts the case's mod-log embed, or rewrites the one it already has.
 *
 * Returns the case as it stands afterwards -- the same row, plus the `log_message_id` a first post just learned.
 * Callers need that to link the case number they are about to quote back at a moderator (#381), and reading it
 * off the returned row is the only way to have it: the id is discovered here, and the row the caller is holding
 * predates it.
 */
export async function dispatchCaseLog(
	modCase: AutomoderatorCases,
	logger: Logger,
	source: ActionSource = 'command',
): Promise<AutomoderatorCases> {
	const webhook = await getModLogWebhook(modCase.guildId);
	if (!webhook) {
		return modCase;
	}

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
		logChannelId: logJumpChannelId(webhook),
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
							wait: true,
							...(webhook.threadId ? { thread_id: webhook.threadId } : {}),
						});
					}
				},
			},
			logger,
		);

		logDispatch.inc({ log_type: 'MOD', result: 'ok' });

		return posted ? await updateCase(modCase.id, { logMessageId: posted.id }) : modCase;
	} catch (error) {
		logDispatch.inc({ log_type: 'MOD', result: 'failed' });

		if (error instanceof DiscordAPIError) {
			if (error.code === RESTJSONErrorCodes.UnknownMessage) {
				const cleared = await updateCase(modCase.id, { logMessageId: null });
				logger.warn({ guildId: modCase.guildId, caseId: modCase.caseId }, 'mod log message vanished, cleared it');
				return cleared;
			}

			if (error.code === RESTJSONErrorCodes.UnknownWebhook) {
				await forgetLogWebhook(modCase.guildId, webhook.logType, webhook.webhookId);
				logger.warn({ guildId: modCase.guildId, webhookId: webhook.webhookId }, 'mod log webhook is gone, dropped it');
				return modCase;
			}
		}

		logger.error({ err: error, guildId: modCase.guildId, caseId: modCase.caseId }, 'failed to dispatch a case log');
		return modCase;
	}
}
