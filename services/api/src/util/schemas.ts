import { SnowflakeRegex } from '@sapphire/discord-utilities';
import z from 'zod';

export const snowflakeSchema = z.string().regex(SnowflakeRegex);

export const queryWithFreshSchema = z.strictObject({
	force_fresh: z.stringbool().optional().default(false),
});

/**
 * First paginated route shape in the codebase (`modmail/threads/{listThreads,getThread}.ts`, #261) --
 * cursor-based (an opaque, monotonically-decreasing id to page backwards from) rather than
 * offset/limit, since every paginated list here orders by a `GENERATED ... AS IDENTITY` primary key and
 * an offset would drift under concurrent inserts (new tickets/messages arriving while staff scroll).
 */
export function createPaginationQuerySchema(defaultLimit: number, maxLimit: number) {
	return z.object({
		cursor: z.coerce.number().int().positive().optional(),
		limit: z.coerce.number().int().positive().max(maxLimit).optional().default(defaultLimit),
	});
}
