import type { Logger } from '@chatsift/backend-core';
import { decrypt, getContext } from '@chatsift/backend-core';
import type { AutomoderatorCases, AutomoderatorLogWebhooks } from '@chatsift/db';
import type { APIMessage } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { executeAction } from './actionExecutor.js';
import { buildCaseEmbed } from './caseFormat.js';
import { updateCase } from './cases.js';
import { logDispatch } from './metrics.js';

export async function getModLogWebhook(guildId: string): Promise<AutomoderatorLogWebhooks | null> {
	const [row] = await getContext().db<AutomoderatorLogWebhooks[]>`
		SELECT * FROM automoderator_log_webhooks WHERE guild_id = ${guildId} AND log_type = 'MOD'
	`;

	return row ?? null;
}

async function forgetModLogWebhook(guildId: string): Promise<void> {
	await getContext().db`
		DELETE FROM automoderator_log_webhooks WHERE guild_id = ${guildId} AND log_type = 'MOD'
	`;
}

export async function dispatchCaseLog(modCase: AutomoderatorCases, logger: Logger): Promise<void> {
	const webhook = await getModLogWebhook(modCase.guildId);
	if (!webhook) {
		return;
	}

	const [reference] =
		modCase.refId === null
			? []
			: await getContext().db<AutomoderatorCases[]>`
					SELECT * FROM automoderator_cases
					WHERE guild_id = ${modCase.guildId} AND case_id = ${modCase.refId}
				`;

	const embed = buildCaseEmbed(modCase, { reference: reference ?? null, logChannelId: webhook.channelId });
	const api = getContext().service.client.api;
	const token = decrypt(webhook.webhookToken);

	try {
		let posted: APIMessage | undefined;

		await executeAction(
			{
				action: 'webhook',
				guildId: modCase.guildId,
				source: 'command',
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

		if (posted) {
			await updateCase(modCase.id, { logMessageId: posted.id });
		}

		logDispatch.inc({ log_type: 'MOD', result: 'ok' });
	} catch (error) {
		logDispatch.inc({ log_type: 'MOD', result: 'failed' });

		if (error instanceof DiscordAPIError && error.status === 404) {
			// Either the webhook or the message it points at is gone. A missing *message* is recoverable -- drop
			// the stale id and the next dispatch posts fresh -- but a missing webhook means the channel went with
			// it, so the row goes too.
			if (modCase.logMessageId) {
				await updateCase(modCase.id, { logMessageId: null });
				logger.warn({ guildId: modCase.guildId, caseId: modCase.caseId }, 'mod log message vanished, cleared it');
			} else {
				await forgetModLogWebhook(modCase.guildId);
				logger.warn({ guildId: modCase.guildId }, 'mod log webhook is gone, dropped it');
			}

			return;
		}

		logger.error({ err: error, guildId: modCase.guildId, caseId: modCase.caseId }, 'failed to dispatch a case log');
	}
}
