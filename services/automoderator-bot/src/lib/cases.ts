import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorCaseAction, AutomoderatorCases, Database, DatabaseTransaction } from '@chatsift/db';
import { isUniqueViolation } from '@chatsift/db';
import type { APIUser } from '@discordjs/core';

export interface CaseActor {
	readonly id: string;
	readonly tag: string;
}

export function formatUserTag(user: APIUser): string {
	return user.discriminator === '0' || !user.discriminator ? user.username : `${user.username}#${user.discriminator}`;
}

export function actorFromUser(user: APIUser): CaseActor {
	return { id: user.id, tag: formatUserTag(user) };
}

export async function allocateCaseNumber(
	guildId: string,
	db: Database | DatabaseTransaction = getContext().db,
): Promise<number> {
	const [row] = await db<{ lastCaseId: number }[]>`
		INSERT INTO automoderator_guild_settings (guild_id, last_case_id)
		VALUES (${guildId}, 1)
		ON CONFLICT (guild_id) DO UPDATE SET last_case_id = automoderator_guild_settings.last_case_id + 1
		RETURNING last_case_id
	`;

	if (!row) {
		throw new Error(`Failed to allocate a case number for guild ${guildId}`);
	}

	return row.lastCaseId;
}

export interface CreateCaseOptions {
	readonly action: AutomoderatorCaseAction;
	readonly dryRun: boolean;
	readonly expiresAt?: Date | null;
	readonly guildId: string;
	/**
	 * Set only by event-driven callers (the audit-log observer). A second insert carrying a key that already
	 * exists in this guild resolves to `null` instead of a duplicate row -- see the partial unique index.
	 */
	readonly idempotencyKey?: string | null;
	readonly mod?: CaseActor | null;
	readonly reason?: string | null;
	readonly refId?: number | null;
	readonly target: CaseActor;
}

/**
 * Files a case. Returns `null` when an `idempotencyKey` was given and this guild has already used it, which
 * callers should read as "someone already recorded this event" rather than as a failure.
 *
 * Deliberately does **not** apply the punishment, DM anyone or post a log -- `applyModerationAction` in
 * `moderation.ts` sequences those around this, and the audit-log observer needs exactly this half on its own
 * (Discord already did the action; the case is a record of it).
 */
export async function createCase(options: CreateCaseOptions): Promise<AutomoderatorCases | null> {
	const db = getContext().db;
	const caseId = await allocateCaseNumber(options.guildId);

	const row = {
		guildId: options.guildId,
		caseId,
		refId: options.refId ?? null,
		targetId: options.target.id,
		targetTag: options.target.tag,
		modId: options.mod?.id ?? null,
		modTag: options.mod?.tag ?? null,
		actionType: options.action,
		reason: options.reason ?? null,
		expiresAt: options.expiresAt ?? null,
		dryRun: options.dryRun,
		idempotencyKey: options.idempotencyKey ?? null,
	};

	try {
		const [created] = await db<AutomoderatorCases[]>`
			INSERT INTO automoderator_cases ${db(row)}
			RETURNING *
		`;

		return created!;
	} catch (error) {
		// Insert-and-catch rather than check-then-insert: the index is the mechanism, so two replicas racing on
		// the same redelivered event resolve correctly instead of both passing a prior existence check. The
		// number allocated above is burned in this case, which is what the gap allowance is for.
		if (isUniqueViolation(error, 'automoderator_cases_guild_id_idempotency_key_idx')) {
			return null;
		}

		throw error;
	}
}

export async function getCaseByNumber(guildId: string, caseId: number): Promise<AutomoderatorCases | null> {
	const [row] = await getContext().db<AutomoderatorCases[]>`
		SELECT * FROM automoderator_cases WHERE guild_id = ${guildId} AND case_id = ${caseId}
	`;

	return row ?? null;
}

export async function listCasesForTarget(
	guildId: string,
	targetId: string,
	limit = 100,
): Promise<AutomoderatorCases[]> {
	return getContext().db<AutomoderatorCases[]>`
		SELECT * FROM automoderator_cases
		WHERE guild_id = ${guildId} AND target_id = ${targetId}
		ORDER BY id DESC
		LIMIT ${limit}
	`;
}

export async function countActiveWarns(guildId: string, targetId: string): Promise<number> {
	const [row] = await getContext().db<{ count: string }[]>`
		SELECT count(*) FROM automoderator_cases
		WHERE guild_id = ${guildId}
			AND target_id = ${targetId}
			AND action_type = 'WARN'
			AND pardoned_by IS NULL
			AND dry_run = false
	`;

	return Number(row?.count ?? 0);
}

export interface UpdateCasePatch {
	readonly expiresAt?: Date | null;
	readonly logMessageId?: string | null;
	readonly mod?: CaseActor;
	readonly pardonedBy?: string | null;
	readonly reason?: string | null;
	readonly refId?: number | null;
}

export async function updateCase(id: AutomoderatorCases['id'], patch: UpdateCasePatch): Promise<AutomoderatorCases> {
	const columns: Partial<
		Pick<AutomoderatorCases, 'expiresAt' | 'logMessageId' | 'modId' | 'modTag' | 'pardonedBy' | 'reason' | 'refId'>
	> = {};

	if ('reason' in patch) columns.reason = patch.reason ?? null;
	if ('refId' in patch) columns.refId = patch.refId ?? null;
	if ('expiresAt' in patch) columns.expiresAt = patch.expiresAt ?? null;
	if ('pardonedBy' in patch) columns.pardonedBy = patch.pardonedBy ?? null;
	if ('logMessageId' in patch) columns.logMessageId = patch.logMessageId ?? null;

	if (patch.mod) {
		columns.modId = patch.mod.id;
		columns.modTag = patch.mod.tag;
	}

	const db = getContext().db;
	const [updated] = await db<AutomoderatorCases[]>`
		UPDATE automoderator_cases SET ${db(columns)} WHERE id = ${id} RETURNING *
	`;

	if (!updated) {
		throw new Error(`Case ${id} vanished mid-update`);
	}

	return updated;
}

export async function deleteCase(id: AutomoderatorCases['id']): Promise<void> {
	await getContext().db`DELETE FROM automoderator_cases WHERE id = ${id}`;
}
