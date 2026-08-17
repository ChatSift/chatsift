import type { Logger } from '@chatsift/backend-core';
import { getContext } from '@chatsift/backend-core';
import { MAX_TIMEOUT_SECONDS } from '@chatsift/core';
import type { AutomoderatorCaseAction, AutomoderatorCases } from '@chatsift/db';
import type { ActionSource, ModerationAction } from './actionExecutor.js';
import { executeAction } from './actionExecutor.js';
import { ACTION_PAST_TENSE, formatDuration } from './caseFormat.js';
import { dispatchCaseLog } from './caseLog.js';
import type { CaseActor } from './cases.js';
import { createCase } from './cases.js';
import { resolveDryRun } from './dryRun.js';
import { casesCreated } from './metrics.js';
import { buildLadderRequest, resolveWarnLadderRung } from './warnLadder.js';

export const MAX_MUTE_MS = MAX_TIMEOUT_SECONDS * 1_000;

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

/**
 * A warn landed but the ladder rung it tripped didn't. Carries the warn so the moderator can be told both.
 */
export class LadderFailureError extends Error {
	public constructor(
		public readonly warnCase: AutomoderatorCases,
		public readonly warns: number,
		cause: unknown,
	) {
		super('the warn was filed but its automatic punishment failed', { cause });
		this.name = 'LadderFailureError';
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
	 * MUTE and BAN, in milliseconds. A MUTE is capped at {@link MAX_MUTE_MS} by the caller (Discord's own
	 * ceiling); a BAN has none, because its expiry is ours to honour rather than Discord's -- it becomes an
	 * `expires_at` that `expiredBanSweep.ts` later acts on.
	 */
	readonly durationMs?: number;
	readonly guildId: string;
	/**
	 * Null for anything no human authored -- the scheduler lifting a tempban is the only P2 case. A case with a
	 * null moderator says so; one attributed to whoever issued the original ban would claim they came back and
	 * unbanned somebody.
	 */
	readonly mod: CaseActor | null;
	/**
	 * Whether to DM the target before acting. Off for UNMUTE/UNBAN.
	 */
	readonly notifyTarget?: boolean;
	/**
	 * Forces dry-run on for this one action, whatever the guild currently says. Can only ever turn it *on* --
	 * see `dryRun.ts`. Set by the expiry sweep, which reverses a case recorded long ago and has to honour the
	 * dry-run state that case was filed under rather than today's setting.
	 */
	readonly previewOnly?: boolean;
	readonly reason?: string | null;
	readonly refId?: number | null;
	/**
	 * Skips the warn-ladder evaluation a WARN would otherwise trigger. Only the ladder itself sets this, and
	 * only for the rung it is in the middle of applying -- see `warnLadder.ts`.
	 */
	readonly skipLadder?: boolean;
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
	 * The rung a WARN tripped, if it tripped one. Returned rather than merely logged so the moderator's reply
	 * can say what else just happened to the member -- a `/warn` that silently also banned them is the surprise
	 * an escalation ladder is most likely to produce.
	 */
	readonly ladder?: ModerationResult;
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
	const dryRun = await resolveDryRun(guildId, request.previewOnly);
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
					...(request.previewOnly ? { previewOnly: true } : {}),
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
			{ err: error, enforced, intent: { ...intent, target: target.id, mod: mod?.id ?? null } },
			enforced
				? 'ENFORCED BUT UNRECORDED: the Discord action landed and the case could not be filed'
				: 'failed to file a case',
		);

		throw new CaseFilingError(enforced, error);
	}

	// Only an `idempotencyKey` can make `createCase` return null, and commands never pass one.
	const filedCase = filed!;
	casesCreated.inc({ action, source });

	await dispatchCaseLog(filedCase, logger, source);

	// Rethrown only now that the case exists and its log is out, so the moderator's error message and the
	// permanent record agree about what happened.
	if (softbanUnbanFailure) {
		throw softbanUnbanFailure;
	}

	// Last, and only once the warn is fully on the record: a rung fires with `refId` pointing at this case, and
	// referencing a case whose log never posted would be a number staff cannot look up.
	if (action !== 'WARN' || request.skipLadder) {
		return { case: filedCase, suppressed };
	}

	const rung = await resolveWarnLadderRung({ warnCase: filedCase, dryRun: suppressed }, logger);
	if (!rung) {
		return { case: filedCase, suppressed };
	}

	try {
		return {
			case: filedCase,
			suppressed,
			ladder: await applyModerationAction(buildLadderRequest(rung, filedCase, mod), logger),
		};
	} catch (error) {
		// The warn itself succeeded and is recorded. Surfaced as its own error rather than swallowed or merged
		// into the warn's failure path, because the moderator needs to be told both halves: the warn landed, and
		// the punishment it was supposed to trigger did not.
		throw new LadderFailureError(filedCase, rung.warns, error);
	}
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

export function buildAuditReason(mod: CaseActor | null, reason?: string | null): string {
	// 512 cap for the header. `AutoModerator` rather than an empty prefix when nobody authored it: the audit log
	// is read by people who do not know this bot's internals, and a bare reason there reads as an action with no
	// source at all.
	const author = mod ? `${mod.tag} (${mod.id})` : 'AutoModerator';
	return `${author}${reason ? `: ${reason}` : ''}`.slice(0, 512);
}
