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

	public async unrole(cs: Selectable<Case>, data: Selectable<RoleCaseCreateData>): Promise<void> {
		const member = await this.api.guilds.getMember(cs.guildId, cs.targetId);
		const initialRoles = await this.util.getNonManagedMemberRoles(cs.guildId, member);

		const undoRoles = await this.db
			.selectFrom('UndoRestrictRole')
			.select('roleId')
			.where('caseId', '=', cs.id)
			.execute();
		const roles = data.clean ? [...initialRoles, ...undoRoles.map((role) => role.roleId)] : initialRoles;

		await this.api.guilds.editMember(cs.guildId, cs.targetId, { roles: roles.filter((role) => role !== data.roleId) });

		await this.db.transaction().execute(async (transaction) => {
			await transaction
				.insertInto('Case')
				.values({
					guildId: cs.guildId,
					targetId: cs.targetId,
					modId: data.modId,
					actionType: CaseAction.unrestrict,
					reason: data.reason,
				})
				.execute();

			await transaction.deleteFrom('UndoRestrictRole').where('caseId', '=', cs.id).execute();

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
