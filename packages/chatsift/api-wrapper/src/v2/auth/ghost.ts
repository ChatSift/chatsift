// /api/v2/auth/ghost
import * as zod from 'zod';

// GET /
export const GetAuthGhostQuerySchema = zod
	.object({
		code: zod.string(),
		state: zod.string(),
	})
	.optional()
	.or(zod.object({}));
export type GetAuthGhostQuery = zod.infer<typeof GetAuthGhostQuerySchema>;
export type GetAuthGhostResult = never;
