import type { Logger } from '@chatsift/backend-core';
import { decrypt, getContext } from '@chatsift/backend-core';
import type { AutomoderatorLogType, AutomoderatorLogWebhooks } from '@chatsift/db';
import type { APIEmbed } from '@discordjs/core';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import type { ActionSource } from './actionExecutor.js';
import { executeAction } from './actionExecutor.js';
import { logDispatch } from './metrics.js';

/**
 * The shared half of every guild log: finding the webhook, posting through it, and self-healing when the
 * channel behind it is gone.
 *
 * Factored out of `caseLog.ts` at P4, when the message and user logs became the second and third writers. The
 * mod log keeps its own module because it does something none of the others do -- it *rewrites* an existing
 * message when a case is amended, which needs the case row to remember the message id. Everything a
 * fire-and-forget log needs is here.
 */

/**
 * Runtime values for `automoderator_log_type`. Same arrangement, and the same reason, as `caseActions.ts`'s
 * `CASE_ACTION`: kanel generates the enum as a real TypeScript enum but `@chatsift/db` re-exports only the
 * type of it, so there is no value to reference and a bare `'MESSAGE'` is not assignable to it.
 */
export const LOG_TYPE = {
	MOD: 'MOD' as AutomoderatorLogType,
	FILTER: 'FILTER' as AutomoderatorLogType,
	MESSAGE: 'MESSAGE' as AutomoderatorLogType,
	USER: 'USER' as AutomoderatorLogType,
} as const satisfies Record<string, AutomoderatorLogType>;

export async function getLogWebhook(
	guildId: string,
	logType: AutomoderatorLogType,
): Promise<AutomoderatorLogWebhooks | null> {
	const [row] = await getContext().db<AutomoderatorLogWebhooks[]>`
		SELECT * FROM automoderator_log_webhooks WHERE guild_id = ${guildId} AND log_type = ${logType}
	`;

	return row ?? null;
}

/**
 * Drops the row for a webhook Discord no longer knows about -- a deleted channel, or a moderator deleting the
 * integration by hand. Carried over from legacy, and the reason a guild that deletes its log channel goes quiet
 * instead of erroring on every event forever.
 *
 * Keyed on the webhook id as well as the type so a dispatch racing a reconfiguration cannot delete the *new*
 * row on the strength of the old one's 404.
 */
export async function forgetLogWebhook(
	guildId: string,
	logType: AutomoderatorLogType,
	webhookId: string,
): Promise<void> {
	await getContext().db`
		DELETE FROM automoderator_log_webhooks
		WHERE guild_id = ${guildId} AND log_type = ${logType} AND webhook_id = ${webhookId}
	`;
}

export interface DispatchLogOptions {
	/**
	 * At most ten, which is Discord's per-execute limit. Every current call site posts one.
	 */
	readonly embeds: APIEmbed[];
	readonly source: ActionSource;
}

/**
 * Posts to a guild's log through a webhook the caller has already resolved.
 *
 * The lookup is the caller's rather than this function's so an observer can bail on a guild that has no log of
 * that type *before* paying for the rest of its work -- which is the overwhelmingly common case, since a log
 * nobody configured is the default state. It also means `guildId`/`logType` come off the row instead of being
 * passed alongside it and able to disagree with it.
 *
 * **Never throws**, and everything that could is inside the try for that reason -- `decrypt` included, which
 * fails on a rotated `ENCRYPTION_KEY` and would otherwise escape a function whose whole contract is that it
 * cannot. A log that can't be delivered must not take down the event handler that produced it; the failure is
 * counted (`automoderator_log_dispatch_total{result="failed"}`) and logged, which is what the roadmap's "watch
 * in the logs" section reads.
 */
export async function dispatchLog(
	webhook: AutomoderatorLogWebhooks,
	options: DispatchLogOptions,
	logger: Logger,
): Promise<void> {
	const { embeds, source } = options;
	const { guildId, logType } = webhook;

	try {
		const api = getContext().service.client.api;
		const token = decrypt(webhook.webhookToken);

		await executeAction(
			{
				action: 'webhook',
				guildId,
				source,
				async execute() {
					await api.webhooks.execute(webhook.webhookId, token, {
						embeds,
						wait: false,
						...(webhook.threadId ? { thread_id: webhook.threadId } : {}),
					});
				},
			},
			logger,
		);

		logDispatch.inc({ log_type: logType, result: 'ok' });
	} catch (error) {
		logDispatch.inc({ log_type: logType, result: 'failed' });

		if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownWebhook) {
			await forgetLogWebhook(guildId, logType, webhook.webhookId);
			logger.warn({ guildId, logType, webhookId: webhook.webhookId }, 'log webhook is gone, dropped it');
			return;
		}

		logger.error({ err: error, guildId, logType }, 'failed to dispatch a guild log');
	}
}
