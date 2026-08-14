import { decrypt, getContext } from '@chatsift/backend-core';
import type { CaseActionName } from '@chatsift/core';
import { buildCaseEmbed } from '@chatsift/core';
import type { AutomoderatorCases, AutomoderatorLogWebhooks } from '@chatsift/db';
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
		// A 404 here means the message was deleted by hand. Clearing the id lets the bot post a fresh one the
		// next time this case changes, rather than retrying an edit that can never succeed.
		if (error instanceof DiscordAPIError && error.status === 404) {
			await context.db`UPDATE automoderator_cases SET log_message_id = NULL WHERE id = ${modCase.id}`;
			return;
		}

		context.logger.warn(
			{ err: error, caseId: modCase.caseId, guildId: modCase.guildId },
			'failed to refresh a case log',
		);
	}
}
