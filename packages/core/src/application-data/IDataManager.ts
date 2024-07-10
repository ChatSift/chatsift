import type { Selectable } from 'kysely';
import type { Experiment, ExperimentOverride, Incident, ModCase, ModCaseKind } from '../db.js';

export type ExperimentWithOverrides = Selectable<Experiment> & { overrides: Selectable<ExperimentOverride>[] };

export interface CreateModCaseData {
	guildId: string;
	kind: ModCaseKind;
	modId: string;
	reason: string;
	userId: string;
}

/**
 * Abstraction over all database interactions
 */
export abstract class IDataManager {
	public abstract getExperiments(): Promise<ExperimentWithOverrides[]>;
	public abstract createIncident(error: Error, guildId?: string): Promise<Selectable<Incident>>;

	public abstract createModCase(data: CreateModCaseData): Promise<Selectable<ModCase>>;
}
