import { API } from '@discordjs/core';
import { injectable } from 'inversify';
import { Kysely } from 'kysely';
import type { Selectable } from 'kysely';
import { CaseAction, type Case, type DB, type RoleCaseData, TaskType } from '../db.js';
import { Util } from '../singletons/Util.js';
import { sqlJson } from '../util/sqlJson.js';
import type { IRoleModAction, RoleCaseCreateData } from './IModAction';

@injectable()
export class RoleModAction implements IRoleModAction {
	public constructor(
		private readonly api: API,
		private readonly db: Kysely<DB>,
		private readonly util: Util,
	) {}

	public async execute(data: RoleCaseCreateData): Promise<Selectable<Case> & Selectable<RoleCaseData>> {
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
					actionType: CaseAction.role,
					reason: data.reason,
				})
				.returningAll()
				.executeTakeFirst();

			const roleData = await transaction
				.insertInto('RoleCaseData')
				.values({
					id: cs!.id,
					roleId: data.roleId,
					clean: data.clean,
					duration: data.duration,
					expiresAt: data.expiresAt,
				})
				.returningAll()
				.executeTakeFirst();

			if (data.duration) {
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
				.insertInto('UndoRole')
				.values(undoRoles.map((roleId) => ({ caseId: cs!.id, roleId })))
				.execute();

			return { ...cs!, ...roleData! };
		});
	}

	public async notify(data: RoleCaseCreateData): Promise<void> {}
}
