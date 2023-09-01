import { sql, type RawBuilder } from 'kysely';

export function sqlJson<T>(value: T): RawBuilder<T> {
	return sql`CAST(${JSON.stringify(value)} AS JSONB)`;
}
