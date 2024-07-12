import { injectable } from 'inversify';
import type { Selectable } from 'kysely';
import type {
	Experiment,
	ExperimentOverride,
	Incident,
	LogWebhook,
	LogWebhookKind,
	ModCase,
	ModCaseKind,
	ModCaseLogMessage,
} from '../db.js';

export type ExperimentWithOverrides = Selectable<Experiment> & { overrides: Selectable<ExperimentOverride>[] };

export interface CreateModCaseOptions {
	guildId: string;
	kind: ModCaseKind;
	modId: string;
	reason: string;
	references: number[];
	targetId: string;
}

export interface GetRecentCasesAgainstOptions {
	guildId: string;
	targetId: string;
}

export type CaseWithLogMessage = Selectable<ModCase> & { logMessage: Selectable<ModCaseLogMessage> | null };

/**
 * Abstraction over all database interactions
 */
@injectable()
export abstract class IDatabase {
	public constructor() {
		if (this.constructor === IDatabase) {
			throw new Error('This class cannot be instantiated.');
		}
	}

	public abstract getExperiments(): Promise<ExperimentWithOverrides[]>;
	public abstract createIncident(error: Error, guildId?: string): Promise<Selectable<Incident>>;

	public abstract getModCase(caseId: number): Promise<Selectable<CaseWithLogMessage> | undefined>;
	public abstract getModCaseBulk(caseIds: number[]): Promise<CaseWithLogMessage[]>;
	public abstract getRecentCasesAgainst(options: GetRecentCasesAgainstOptions): Promise<CaseWithLogMessage[]>;

	public abstract createModCase(options: CreateModCaseOptions): Promise<Selectable<ModCase>>;

	public abstract createModCaseLogMessage(
		options: Selectable<ModCaseLogMessage>,
	): Promise<Selectable<ModCaseLogMessage>>;

	public abstract getLogWebhook(guildId: string, kind: LogWebhookKind): Promise<Selectable<LogWebhook> | undefined>;
}
