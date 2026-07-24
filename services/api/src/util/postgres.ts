import postgres from 'postgres';

export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
	if (!(error instanceof postgres.PostgresError)) {
		return false;
	}

	return error.code === '23505' && (constraintName === undefined || error.constraint_name === constraintName);
}
