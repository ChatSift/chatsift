import { API } from '@discordjs/core';
import { inject, injectable } from 'inversify';
import { Kysely, type Selectable } from 'kysely';
import { CaseAction, TaskType, type DB, type Case } from '../db.js';
import { sqlJson } from '../util/sqlJson.js';
import { Util } from './Util.js';

export type OptionalCaseCreateDurationData =
	| {
			duration: null;
			expiresAt: null;
	  }
	| {
			duration: number;
			expiresAt: Date;
	  };

export interface BaseCaseCreateData {
	guildId: string;
	modId: string;
	reason?: string;
	targetId: string;
}

export interface RoleCaseCreateData extends BaseCaseCreateData {
	clean: boolean;
	roleId: string;
}

@injectable()
export class CaseManager {
	public constructor(
		private readonly api: API,
		@inject(Kysely) private readonly db: Kysely<DB>,
		private readonly util: Util,
	) {}

	public async role(data: OptionalCaseCreateDurationData & RoleCaseCreateData): Promise<void> {
		const member = await this.api.guilds.getMember(data.guildId, data.targetId);
		const initialRoles = await this.util.getNonManagedMemberRoles(data.guildId, member);

		const roles = data.clean ? [data.roleId] : [...initialRoles, data.roleId];
		const undoRoles = data.clean ? initialRoles : [];

		await this.api.guilds.editMember(data.guildId, data.targetId, { roles });

		await this.db.transaction().execute(async (transaction) => {
			const cs = await transaction
				.insertInto('Case')
				.values({
					guildId: data.guildId,
					targetId: data.targetId,
					modId: data.modId,
					actionType: CaseAction.role,
					reason: data.reason,
				})
				.returning('id')
				.executeTakeFirst();

			await transaction
				.insertInto('RoleCaseData')
				.values({
					id: cs!.id,
					roleId: data.roleId,
					clean: data.clean,
					duration: data.duration,
					expiresAt: data.expiresAt,
				})
				.execute();

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
		});
	}

	public async unrole(cs: Selectable<Case>, data: Selectable<RoleCaseCreateData>): Promise<void> {
		const member = await this.api.guilds.getMember(cs.guildId, cs.targetId);
		const initialRoles = await this.util.getNonManagedMemberRoles(cs.guildId, member);

		const undoRoles = await this.db.selectFrom('UndoRole').select('roleId').where('caseId', '=', cs.id).execute();
		const roles = data.clean ? [...initialRoles, ...undoRoles.map((role) => role.roleId)] : initialRoles;

		await this.api.guilds.editMember(cs.guildId, cs.targetId, { roles: roles.filter((role) => role !== data.roleId) });

		await this.db.transaction().execute(async (transaction) => {
			await transaction
				.insertInto('Case')
				.values({
					guildId: cs.guildId,
					targetId: cs.targetId,
					modId: data.modId,
					actionType: CaseAction.unrole,
					reason: data.reason,
				})
				.execute();

			await transaction.deleteFrom('UndoRole').where('caseId', '=', cs.id).execute();

			await transaction
				.deleteFrom('Task')
				.where('data', '@>', sqlJson({ caseId: cs.id }))
				.execute();
		});
	}

	public async warn(data: BaseCaseCreateData): Promise<void> {
		await this.db.transaction().execute(async (transaction) => {
			const cs = await transaction
				.insertInto('Case')
				.values({
					guildId: data.guildId,
					targetId: data.targetId,
					modId: data.modId,
					actionType: CaseAction.warn,
					reason: data.reason,
				})
				.returning('id')
				.executeTakeFirst();

			await transaction
				.insertInto('WarnCaseData')
				.values({
					id: cs!.id,
				})
				.execute();
		});
	}
}