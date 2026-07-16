import postgres from 'postgres';

export type Database = postgres.Sql;

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
