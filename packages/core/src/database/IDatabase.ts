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
	Report,
	Settings,
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

export interface GetRecentModCasesAgainstOptions {
	guildId: string;
	targetId: string;
}

export interface GetModCasesAgainstOptions extends GetRecentModCasesAgainstOptions {
	page: number;
}

export type CaseWithLogMessage = Selectable<ModCase> & { logMessage: Selectable<ModCaseLogMessage> | null };

export type UpdateModCaseOptions = Partial<Omit<Selectable<ModCase>, 'id'>> & { references?: number[] };

export interface CreateReporterOptions {
	reason: string;
	reportId: number;
	userId: string;
}

export interface CreateReportOptions {
	reportMessageId: string;
	reporter: Omit<CreateReporterOptions, 'reportId'>;
}

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
	public abstract getModCaseReferences(caseId: number): Promise<CaseWithLogMessage[]>;
	public abstract getModCaseBulk(caseIds: number[]): Promise<CaseWithLogMessage[]>;
	public abstract getModCasesAgainst(options: GetModCasesAgainstOptions): Promise<CaseWithLogMessage[]>;
	public abstract getRecentModCasesAgainst(options: GetRecentModCasesAgainstOptions): Promise<CaseWithLogMessage[]>;
	public abstract createModCase(options: CreateModCaseOptions): Promise<Selectable<ModCase>>;
	public abstract updateModCase(caseId: number, data: UpdateModCaseOptions): Promise<CaseWithLogMessage>;
	public abstract deleteModCase(caseId: number): Promise<void>;

	public abstract upsertModCaseLogMessage(
		options: Selectable<ModCaseLogMessage>,
	): Promise<Selectable<ModCaseLogMessage>>;

	public abstract getLogWebhook(guildId: string, kind: LogWebhookKind): Promise<Selectable<LogWebhook> | undefined>;

	public abstract getSettings(guildId: string): Promise<Selectable<Settings>>;

	public abstract createReport(options: CreateReportOptions): Promise<Selectable<Report>>;
}
