import { injectable } from 'inversify';
import { sql, Kysely, type Selectable } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB, Incident, LogWebhook, LogWebhookKind, ModCase } from '../db.js';
import {
	IDataManager,
	type CreateModCaseOptions,
	type ExperimentWithOverrides,
	type GetRecentCasesAgainstOptions,
} from './IDataManager.js';

/**
 * Our current database implementation, using kysely with types generated by prisma-kysely
 */
@injectable()
export class KyselyDataManager extends IDataManager {
	public constructor(private readonly database: Kysely<DB>) {
		super();
	}

	public override async getExperiments(): Promise<ExperimentWithOverrides[]> {
		return this.database
			.selectFrom('Experiment')
			.selectAll()
			.select((query) => [
				jsonArrayFrom(
					query
						.selectFrom('ExperimentOverride')
						.selectAll('ExperimentOverride')
						.whereRef('Experiment.name', '=', 'ExperimentOverride.experimentName'),
				).as('overrides'),
			])
			.execute();
	}

	public override async createIncident(error: Error, guildId?: string): Promise<Selectable<Incident>> {
		const causeStack = error.cause && error.cause instanceof Error ? error.cause.stack ?? error.cause.message : null;

		return this.database
			.insertInto('Incident')
			.values({
				guildId,
				stack: error.stack ?? error.message,
				causeStack,
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	}

	public override async createModCase(data: CreateModCaseOptions): Promise<Selectable<ModCase>> {
		return this.database.insertInto('ModCase').values(data).returningAll().executeTakeFirstOrThrow();
	}

	public override async getRecentCasesAgainst({
		guildId,
		targetId: userId,
	}: GetRecentCasesAgainstOptions): Promise<Selectable<ModCase>[]> {
		return this.database
			.selectFrom('ModCase')
			.selectAll()
			.where('guildId', '=', guildId)
			.where('targetId', '=', userId)
			.where('createdAt', '>', sql<Date>`NOW() - INTERVAL '1 HOUR'`)
			.execute();
	}

	public override async getLogWebhook(
		guildId: string,
		kind: LogWebhookKind,
	): Promise<Selectable<LogWebhook> | undefined> {
		return this.database
			.selectFrom('LogWebhook')
			.selectAll()
			.where('guildId', '=', guildId)
			.where('kind', '=', kind)
			.executeTakeFirst();
	}
}
