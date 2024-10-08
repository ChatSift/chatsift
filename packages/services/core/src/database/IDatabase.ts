import type { Snowflake } from '@discordjs/core';
import { injectable } from 'inversify';
import type { Selectable } from 'kysely';
import type {
	DiscordOAuth2User,
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

export interface GetRecentModCasesAgainstOptions {
	guildId: string;
	targetId: string;
}

export interface GetModCasesAgainstOptions extends GetRecentModCasesAgainstOptions {
	page: number;
}

export type CaseWithLogMessage = Selectable<ModCase> & { logMessage: Selectable<ModCaseLogMessage> | null };

export type UpdateModCaseOptions = Partial<Omit<Selectable<ModCase>, 'id'>> & { references?: number[] };

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

	public abstract getDiscordOAuth2User(userId: Snowflake): Promise<Selectable<DiscordOAuth2User> | undefined>;
	public abstract upsertDiscordOAuth2User(user: Selectable<DiscordOAuth2User>): Promise<Selectable<DiscordOAuth2User>>;
}
