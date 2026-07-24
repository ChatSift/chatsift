/**
 * `postgres.js` throws a plain `PostgresError`-shaped object (not exported as a class we can `instanceof` against
 * without adding `postgres` as a direct dependency here) -- duck-typing the two fields we care about is simpler
 * than pulling in the package solely for its error type.
 */
export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
	const { code, constraint_name: name } = error as { code?: string; constraint_name?: string };
	return code === '23505' && (constraintName === undefined || name === constraintName);
}
