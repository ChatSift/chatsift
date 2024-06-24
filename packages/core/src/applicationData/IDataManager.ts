import type { Selectable } from 'kysely';
import type { Experiment, ExperimentOverride, Incident } from '../db.js';

export type ExperimentWithOverrides = Selectable<Experiment> & { overrides: Selectable<ExperimentOverride>[] };

/**
 * Abstraction over all database interactions (things like Redis included)
 */
export abstract class IDataManager {
	public abstract getExperiments(): Promise<ExperimentWithOverrides[]>;
	public abstract createIncident(error: Error, guildId?: string): Promise<Selectable<Incident>>;
}
