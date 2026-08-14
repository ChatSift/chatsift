import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { fetchUser, getSelfId } from '@chatsift/bot-core';
import type { AutomoderatorCaseAction } from '@chatsift/db';
import type { APIAuditLogEntry, Client } from '@discordjs/core';
import { AuditLogEvent, GatewayDispatchEvents } from '@discordjs/core';
import { CASE_ACTION } from './caseActions.js';
import { dispatchCaseLog } from './caseLog.js';
import type { CaseActor } from './cases.js';
import { createCase, formatUserTag } from './cases.js';
import { traceDecision } from './decisionTrace.js';
import { casesCreated } from './metrics.js';

const OBSERVED: Partial<Record<AuditLogEvent, AutomoderatorCaseAction>> = {
	[AuditLogEvent.MemberBanAdd]: CASE_ACTION.BAN,
	[AuditLogEvent.MemberBanRemove]: CASE_ACTION.UNBAN,
	[AuditLogEvent.MemberKick]: CASE_ACTION.KICK,
};

export function registerAuditObserver(client: Client): void {
	client.on(GatewayDispatchEvents.GuildAuditLogEntryCreate, async ({ data }) => {
		const logger = getContext().logger.child({ event: 'guildAuditLogEntryCreate', guildId: data.guild_id });

		try {
			await handleAuditLogEntry(data, data.guild_id, logger);
		} catch (error) {
			// A rejected listener is re-emitted as an `'error'` event by @discordjs/core, so every listener in
			// this codebase catches its own.
			logger.error({ err: error, entryId: data.id }, 'failed to observe an audit log entry');
		}
	});
}

async function handleAuditLogEntry(entry: APIAuditLogEntry, guildId: string, logger: Logger): Promise<void> {
	const action = OBSERVED[entry.action_type];
	if (!action || !entry.target_id || !entry.user_id) {
		return;
	}

	const api = getContext().service.client.api;

	if (entry.user_id === (await getSelfId(api))) {
		return;
	}

	const [targetUser, modUser] = await Promise.all([fetchUser(api, entry.target_id), fetchUser(api, entry.user_id)]);

	const target: CaseActor = {
		id: entry.target_id,
		tag: targetUser ? formatUserTag(targetUser) : 'Unknown User',
	};

	const mod: CaseActor | null = modUser ? { id: entry.user_id, tag: formatUserTag(modUser) } : null;

	const filed = await createCase({
		action,
		guildId,
		target,
		mod,
		dryRun: false,
		reason: entry.reason ?? null,
		idempotencyKey: `audit:${entry.id}`,
	});

	if (!filed) {
		logger.debug({ entryId: entry.id }, 'audit log entry was already recorded, skipping');
		return;
	}

	traceDecision(logger, {
		runner: 'observer',
		action: action.toLowerCase(),
		guildId,
		targetId: target.id,
		dryRun: false,
	});

	casesCreated.inc({ action, source: 'observer' });
	await dispatchCaseLog(filed, logger);
}
