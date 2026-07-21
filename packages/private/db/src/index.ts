import postgres from 'postgres';

export type Database = postgres.Sql;

// Generated row types (kanel — see docs/adr/0002-db-stack.md), re-exported from the package root so consumers can
// annotate `getContext().db<Row[]>` queries against the real schema instead of hand-duplicating row shapes. Add a
// table's types here the first time a consumer actually needs them — see docs/roadmap/02-foundation.md Part C.
export type { default as AmaPromptData, AmaPromptDataId } from './generated/public/AmaPromptData.js';
export type { default as AmaQuestions, AmaQuestionsId } from './generated/public/AmaQuestions.js';
export type { default as AmaQuestionState } from './generated/public/AmaQuestionState.js';
export type { default as AmaSessions, AmaSessionsId } from './generated/public/AmaSessions.js';
export type { default as DashboardGrants, DashboardGrantsId } from './generated/public/DashboardGrants.js';

export interface CreateDbOptions {
	/**
	 * Passed through to `postgres()`, merged on top of the `postgres.camel` transform default
	 * (see docs/roadmap/02-foundation.md Part A step 2 for the snake_case + camel-transform decision).
	 */
	options?: postgres.Options<Record<string, postgres.PostgresType>>;
	url: string;
}

export function createDb({ url, options }: CreateDbOptions): Database {
	return postgres(url, { transform: postgres.camel, ...options });
}
