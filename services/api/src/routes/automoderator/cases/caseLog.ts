import { decrypt, getContext } from '@chatsift/backend-core';
import type { CaseActionName } from '@chatsift/core';
import { buildCaseEmbed } from '@chatsift/core';
import type { AutomoderatorCases, AutomoderatorLogWebhooks } from '@chatsift/db';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { discordAPIWebhook } from '../../../util/discordAPI.js';

/**
 * Rewrites a case's existing mod-log embed after the dashboard amends it, so the log and the case can't
 * disagree about what a case says. `services/automoderator-bot` does the same thing when `/case reason` runs.
 */
export async function refreshCaseLog(modCase: AutomoderatorCases): Promise<void> {
	if (!modCase.logMessageId) {
		return;
	}

	const context = getContext();

	const [webhook] = await context.db<AutomoderatorLogWebhooks[]>`
		SELECT * FROM automoderator_log_webhooks WHERE guild_id = ${modCase.guildId} AND log_type = 'MOD'
	`;

	if (!webhook) {
		return;
	}

	const [reference] =
		modCase.refId === null
			? []
			: await context.db<AutomoderatorCases[]>`
					SELECT * FROM automoderator_cases
					WHERE guild_id = ${modCase.guildId} AND case_id = ${modCase.refId}
				`;

	try {
		await discordAPIWebhook.webhooks.editMessage(
			webhook.webhookId,
			decrypt(webhook.webhookToken),
			modCase.logMessageId,
			{
				embeds: [
					buildCaseEmbed(
						{ ...modCase, actionType: modCase.actionType as unknown as CaseActionName },
						{
							logChannelId: webhook.channelId,
							reference: reference ? { logMessageId: reference.logMessageId } : null,
						},
					),
				],
				...(webhook.threadId ? { thread_id: webhook.threadId } : {}),
			},
		);
	} catch (error) {
		// Both of these are 404s, and they need opposite remedies -- which is why this matches on the JSON code
		// rather than the status, same as the bot's `dispatchCaseLog`.
		if (error instanceof DiscordAPIError) {
			// Deleted by hand. Clearing the id lets the bot post a fresh one the next time this case changes,
			// rather than retrying an edit that can never succeed.
			if (error.code === RESTJSONErrorCodes.UnknownMessage) {
				await context.db`UPDATE automoderator_cases SET log_message_id = NULL WHERE id = ${modCase.id}`;
				return;
			}

			// The webhook itself is gone (channel deleted, or someone removed it in Discord's UI). Clearing
			// `log_message_id` would be the wrong fix: the message may well still exist, and the dead row would go
			// on failing every later case. Drop the row instead so the guild is prompted to reconfigure.
			if (error.code === RESTJSONErrorCodes.UnknownWebhook) {
				await context.db`
					DELETE FROM automoderator_log_webhooks
					WHERE guild_id = ${modCase.guildId} AND log_type = 'MOD' AND webhook_id = ${webhook.webhookId}
				`;
				return;
			}
		}

		context.logger.warn(
			{ err: error, caseId: modCase.caseId, guildId: modCase.guildId },
			'failed to refresh a case log',
		);
	}
}
