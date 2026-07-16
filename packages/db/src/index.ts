import postgres from 'postgres';

export type Database = postgres.Sql;

export interface CreateDbOptions {
	/**
	 * Passed through to `postgres()` as-is. Row/column naming convention (e.g. a `postgres.camel`
	 * transform) is decided alongside the schema — see docs/roadmap/02-foundation.md Part A.
	 */
	options?: postgres.Options<Record<string, postgres.PostgresType>>;
	url: string;
}

export function createDb({ url, options }: CreateDbOptions): Database {
	return postgres(url, options);
}
