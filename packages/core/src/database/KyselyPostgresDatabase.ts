import { injectable } from 'inversify';
import { sql, Kysely, type Selectable, PostgresDialect } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { CaseReference, DB, Incident, LogWebhook, LogWebhookKind, ModCase } from '../db.js';
import { Env } from '../util/Env.js';
import {
	IDatabase,
	type CreateModCaseOptions,
	type ExperimentWithOverrides,
	type GetRecentCasesAgainstOptions,
} from './IDatabase.js';

// no proper ESM support
const {
	default: { Pool },
} = await import('pg');

/**
 * Our current database implementation, using kysely with types generated by prisma-kysely
 */
@injectable()
export class KyselyPostgresDatabase extends IDatabase {
	readonly #database: Kysely<DB>;

	public constructor(private readonly env: Env) {
		super();

		this.#database = new Kysely<DB>({
			dialect: new PostgresDialect({
				pool: new Pool({
					host: this.env.postgresHost,
					port: this.env.postgresPort,
					user: this.env.postgresUser,
					password: this.env.postgresPassword,
					database: this.env.postgresDatabase,
				}),
			}),
		});
	}

	public override async getExperiments(): Promise<ExperimentWithOverrides[]> {
		return this.#database
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

		return this.#database
			.insertInto('Incident')
			.values({
				guildId,
				stack: error.stack ?? error.message,
				causeStack,
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	}

	public override async getModCase(caseId: number): Promise<Selectable<ModCase> | undefined> {
		return this.#database.selectFrom('ModCase').selectAll().where('id', '=', caseId).executeTakeFirst();
	}

	public override async getModCaseBulk(caseIds: number[]): Promise<Selectable<ModCase>[]> {
		return this.#database.selectFrom('ModCase').selectAll().where('id', 'in', caseIds).execute();
	}

	public override async getRecentCasesAgainst({
		guildId,
		targetId: userId,
	}: GetRecentCasesAgainstOptions): Promise<Selectable<ModCase>[]> {
		return this.#database
			.selectFrom('ModCase')
			.selectAll()
			.where('guildId', '=', guildId)
			.where('targetId', '=', userId)
			.where('createdAt', '>', sql<Date>`NOW() - INTERVAL '1 HOUR'`)
			.orderBy('ModCase.createdAt desc')
			.execute();
	}

	public override async createModCase({ references, ...data }: CreateModCaseOptions): Promise<Selectable<ModCase>> {
		return this.#database.transaction().execute(async (trx) => {
			const modCase = await trx.insertInto('ModCase').values(data).returningAll().executeTakeFirstOrThrow();

			if (references.length) {
				await trx
					.insertInto('CaseReference')
					.values(references.map((referencesId) => ({ referencedById: modCase.id, referencesId })))
					.execute();
			}

			return modCase;
		});
	}

	public override async getLogWebhook(
		guildId: string,
		kind: LogWebhookKind,
	): Promise<Selectable<LogWebhook> | undefined> {
		return this.#database
			.selectFrom('LogWebhook')
			.selectAll()
			.where('guildId', '=', guildId)
			.where('kind', '=', kind)
			.executeTakeFirst();
	}
}
