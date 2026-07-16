import postgres from 'postgres';

export type Database = postgres.Sql;

// Generated row types (kanel — see docs/adr/0002-db-stack.md), re-exported from the package root so consumers can
// annotate `rawDb<Row[]>` queries against the real schema instead of hand-duplicating row shapes. Add a table's
// types here the first time a consumer actually needs them — see docs/roadmap/02-foundation.md Part C.
export type { default as AmaPromptData, AmaPromptDataId } from './generated/public/AmaPromptData.js';
export type { default as AmaSessions, AmaSessionsId } from './generated/public/AmaSessions.js';

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
