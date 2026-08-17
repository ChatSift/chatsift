import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorCaseAction, AutomoderatorCases } from '@chatsift/db';
import type { ActionSource, ModerationAction } from './actionExecutor.js';
import { executeAction } from './actionExecutor.js';
import { ACTION_PAST_TENSE, formatDuration } from './caseFormat.js';
import { dispatchCaseLog } from './caseLog.js';
import type { CaseActor } from './cases.js';
import { createCase } from './cases.js';
import { resolveDryRun } from './dryRun.js';
import { casesCreated } from './metrics.js';

// 28 days
export const MAX_MUTE_MS = 28 * 24 * 60 * 60 * 1_000;

const NOTIFY_BEFORE_ACTING = new Set<AutomoderatorCaseAction>(['KICK', 'BAN', 'SOFTBAN'] as AutomoderatorCaseAction[]);

export class SoftbanUnbanError extends Error {
	public constructor(cause: unknown) {
		super('the softban ban succeeded but the follow-up unban failed', { cause });
		this.name = 'SoftbanUnbanError';
	}
}

/**
 * The case row couldn't be written. Distinct from a generic failure because `enforced` decides what the
 * moderator is told: "this didn't happen" and "this happened but isn't on the record" call for opposite
 * follow-up actions, and conflating them is how a moderator bans someone twice.
 */
export class CaseFilingError extends Error {
	public constructor(
		public readonly enforced: boolean,
		cause: unknown,
	) {
		super('the case row could not be written', { cause });
		this.name = 'CaseFilingError';
	}
}

const SIDE_EFFECT: Record<AutomoderatorCaseAction, ModerationAction | null> = {
	WARN: null,
	MUTE: 'mute',
	UNMUTE: 'unmute',
	KICK: 'kick',
	SOFTBAN: 'softban',
	BAN: 'ban',
	UNBAN: 'unban',
};

export interface ModerationRequest {
	readonly action: AutomoderatorCaseAction;
	readonly deleteMessageSeconds?: number;
	/**
	 * MUTE only, in milliseconds. Capped at {@link MAX_MUTE_MS} by the caller.
	 */
	readonly durationMs?: number;
	readonly guildId: string;
	readonly mod: CaseActor;
	/**
	 * Whether to DM the target before acting. Off for UNMUTE/UNBAN.
	 */
	readonly notifyTarget?: boolean;
	readonly reason?: string | null;
	readonly refId?: number | null;
	/**
	 * What decided this. Defaults to `command`, which every mod command is; the report card passes `report` so
	 * "how much of our moderation comes out of the queue" is answerable off the metrics rather than by reading
	 * case reasons.
	 */
	readonly source?: ActionSource;
	readonly target: CaseActor;
}

export interface ModerationResult {
	readonly case: AutomoderatorCases;
	/**
	 * Dry-runs
	 */
	readonly suppressed: boolean;
}

/**
 * Runs one moderation action end to end: DM the target, do the thing, file the case, post the log.
 */
export async function applyModerationAction(request: ModerationRequest, logger: Logger): Promise<ModerationResult> {
	const { action, guildId, target, mod, reason } = request;
	const source = request.source ?? 'command';
	const api = getContext().service.client.api;

	// Resolved once for the row. `executeAction` resolves it again for enforcement -- they agree, and the row
	// must never claim an action the executor suppressed.
	const dryRun = await resolveDryRun(guildId);
	const shouldNotify = request.notifyTarget ?? true;

	if (shouldNotify && NOTIFY_BEFORE_ACTING.has(action)) {
		await notifyTarget(request, logger);
	}

	const sideEffect = SIDE_EFFECT[action];
	let suppressed = dryRun;
	let softbanUnbanFailure: SoftbanUnbanError | null = null;

	if (sideEffect) {
		const auditReason = buildAuditReason(mod, reason);

		try {
			const result = await executeAction(
				{
					action: sideEffect,
					guildId,
					source,
					targetId: target.id,
					...(reason ? { reason } : {}),
					async execute() {
						const performers: Record<AutomoderatorCaseAction, () => Promise<unknown>> = {
							WARN: async () => {
								throw new Error('a warn has no Discord side effect and must not reach the executor');
							},
							MUTE: async () =>
								api.guilds.editMember(
									guildId,
									target.id,
									{ communication_disabled_until: new Date(Date.now() + request.durationMs!).toISOString() },
									{ reason: auditReason },
								),
							UNMUTE: async () =>
								api.guilds.editMember(
									guildId,
									target.id,
									{ communication_disabled_until: null },
									{ reason: auditReason },
								),
							KICK: async () => api.guilds.removeMember(guildId, target.id, { reason: auditReason }),
							BAN: async () =>
								api.guilds.banUser(
									guildId,
									target.id,
									{ delete_message_seconds: request.deleteMessageSeconds ?? 0 },
									{ reason: auditReason },
								),
							// Ban-then-unban: the ban is only a vehicle for the message deletion, so the member is free
							// to rejoin immediately. Both halves carry the same audit reason.
							SOFTBAN: async () => {
								await api.guilds.banUser(
									guildId,
									target.id,
									{ delete_message_seconds: request.deleteMessageSeconds ?? 86_400 },
									{ reason: auditReason },
								);

								try {
									await api.guilds.unbanUser(guildId, target.id, { reason: auditReason });
								} catch (error) {
									throw new SoftbanUnbanError(error);
								}
							},
							UNBAN: async () => api.guilds.unbanUser(guildId, target.id, { reason: auditReason }),
						};

						await performers[action]();
					},
				},
				logger,
			);

			suppressed = result.suppressed;
		} catch (error) {
			if (!(error instanceof SoftbanUnbanError)) {
				throw error;
			}

			// The ban landed and only the lift failed, so the member really *was* actioned. Fall through and file
			// the case, then rethrow once it's recorded -- a banned member with no case explaining it is the worst
			// outcome available here, and it's exactly what rethrowing straight away would produce.
			softbanUnbanFailure = error;
			suppressed = false;
		}
	}

	if (shouldNotify && !NOTIFY_BEFORE_ACTING.has(action)) {
		await notifyTarget(request, logger);
	}

	const intent = {
		action,
		guildId,
		target,
		mod,
		dryRun: suppressed,
		reason: reason ?? null,
		refId: request.refId ?? null,
		expiresAt: request.durationMs ? new Date(Date.now() + request.durationMs) : null,
	};

	let filed: AutomoderatorCases | null;

	try {
		filed = await createCase(intent);
	} catch (error) {
		const enforced = Boolean(sideEffect) && !suppressed;

		logger.error(
			{ err: error, enforced, intent: { ...intent, target: target.id, mod: mod.id } },
			enforced
				? 'ENFORCED BUT UNRECORDED: the Discord action landed and the case could not be filed'
				: 'failed to file a case',
		);

		throw new CaseFilingError(enforced, error);
	}

	// Only an `idempotencyKey` can make `createCase` return null, and commands never pass one.
	const filedCase = filed!;
	casesCreated.inc({ action, source });

	await dispatchCaseLog(filedCase, logger);

	// Rethrown only now that the case exists and its log is out, so the moderator's error message and the
	// permanent record agree about what happened.
	if (softbanUnbanFailure) {
		throw softbanUnbanFailure;
	}

	return { case: filedCase, suppressed };
}

async function notifyTarget(request: ModerationRequest, logger: Logger): Promise<void> {
	const { action, guildId, target, reason, durationMs } = request;
	const api = getContext().service.client.api;

	try {
		const guild = await api.guilds.get(guildId);
		const forDuration = durationMs ? ` for ${formatDuration(durationMs)}` : '';
		const content = `You have been ${ACTION_PAST_TENSE[action]} in **${guild.name}**${forDuration}.${
			reason ? `\n\nReason: ${reason}` : ''
		}`;

		await executeAction(
			{
				action: 'dm',
				guildId,
				source: request.source ?? 'command',
				targetId: target.id,
				async execute() {
					const channel = await api.users.createDM(target.id);
					await api.channels.createMessage(channel.id, { content });
				},
			},
			logger,
		);
	} catch (error) {
		logger.info({ err: error, targetId: target.id, guildId }, 'could not DM the target about their case');
	}
}

export function buildAuditReason(mod: CaseActor, reason?: string | null): string {
	// 512 cap for the header
	return `${mod.tag} (${mod.id})${reason ? `: ${reason}` : ''}`.slice(0, 512);
}
