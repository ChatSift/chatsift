import type { Kysely, Selectable } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB, Incident } from '../db.js';
import { IDataManager, type ExperimentWithOverrides } from './IDataManager.js';

/**
 * Our current databse implementation, using kysely with types generated by prisma-kysely
 */
export class KyselyDataManager extends IDataManager {
	readonly #database: Kysely<DB>;

	// Note that we avoid using an actual dependency. This is because we don't really want to expose database
	// into our container. An implementation over IDataHandler should always be used.
	public constructor(database: Kysely<DB>) {
		super();

		this.#database = database;
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
		return this.#database
			.insertInto('Incident')
			.values({
				guildId,
				stack: error.stack ?? error.message,
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	}
}
