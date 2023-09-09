import { sql, type RawBuilder } from 'kysely';

/**
 * Helper function to cast a value to JSON in a SQL query.
 *
 * @remarks
 * See https://kysely.dev/docs/recipes/extending-kysely#expression
 */
export function sqlJson<T>(value: T): RawBuilder<T> {
	return sql`CAST(${JSON.stringify(value)} AS JSONB)`;
}
