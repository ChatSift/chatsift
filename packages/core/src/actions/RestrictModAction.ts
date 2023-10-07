import { TimestampStyles, time } from '@discordjs/builders';
import { API } from '@discordjs/core';
import { inject, injectable } from 'inversify';
import { Kysely } from 'kysely';
import type { Selectable } from 'kysely';
import { type Logger } from 'pino';
import { CaseAction, type Case, type DB, type RestrictCaseData, TaskType } from '../db.js';
import { INJECTION_TOKENS } from '../singletons/DependencyManager.js';
import { Util } from '../singletons/Util.js';
import { sqlJson } from '../util/sqlJson.js';
import type { IRestrictModAction, RestrictCaseCreateData } from './IModAction.js';

@injectable()
export class RestrictModAction implements IRestrictModAction {
	public constructor(
		private readonly api: API,
		private readonly db: Kysely<DB>,
		private readonly util: Util,
		@inject(INJECTION_TOKENS.logger) private readonly logger: Logger,
	) {}

	public async execute(data: RestrictCaseCreateData): Promise<Selectable<Case> & Selectable<RestrictCaseData>> {
		const member = await this.api.guilds.getMember(data.guildId, data.targetId);
		const initialRoles = await this.util.getNonManagedMemberRoles(data.guildId, member);

		const roles = data.clean ? [data.roleId] : [...initialRoles, data.roleId];
		const undoRoles = data.clean ? initialRoles : [];

		await this.api.guilds.editMember(data.guildId, data.targetId, { roles });

		return this.db.transaction().execute(async (transaction) => {
			const cs = await transaction
				.insertInto('Case')
				.values({
					guildId: data.guildId,
					targetId: data.targetId,
					modId: data.modId,
					actionType: CaseAction.restrict,
					reason: data.reason,
				})
				.returningAll()
				.executeTakeFirst();

			const roleData = await transaction
				.insertInto('RestrictCaseData')
				.values({
					id: cs!.id,
					roleId: data.roleId,
					clean: data.clean,
					expiresAt: data.expiresAt,
				})
				.returningAll()
				.executeTakeFirst();

			if (data.expiresAt) {
				await transaction
					.insertInto('Task')
					.values({
						type: TaskType.undoTimedRoleCase,
						guildId: data.guildId,
						runAt: data.expiresAt,
						data: sqlJson({ caseId: cs!.id }),
					})
					.execute();
			}

			await transaction
				.insertInto('UndoRestrictRole')
				.values(undoRoles.map((roleId) => ({ caseId: cs!.id, roleId })))
				.execute();

			return { ...cs!, ...roleData! };
		});
	}

	public async notify(data: RestrictCaseCreateData): Promise<boolean> {
		const guild = await this.api.guilds.get(data.guildId).catch((error) => {
			this.logger.error(error, 'Failed to fetch guild in notify');
			return null;
		});

		if (!guild) {
			return false;
		}

		const lines: string[] = [
			`You have been restricted in ${guild.name}, the following role has been added to you: <@&${data.roleId}>`,
		];

		if (data.reason) {
			lines.push(`Reason: ${data.reason}`);
		}

		if (data.expiresAt) {
			lines.push(
				`This punishment will expire at: ${time(data.expiresAt, TimestampStyles.LongDateTime)} (${time(
					data.expiresAt,
					TimestampStyles.RelativeTime,
				)})`,
			);
		}

		return this.util.tryDmUser(data.targetId, lines.join('\n'), data.guildId);
	}
}
