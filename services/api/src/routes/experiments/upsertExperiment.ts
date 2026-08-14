import { getContext } from '@chatsift/backend-core';
import type { Experiments } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../core/route.js';
import { isAuthed } from '../../middleware/isAuthed.js';
import { upsertExperimentBodySchema } from '../automoderator/schemas.js';
import type { ExperimentWithOverrides } from './listExperiments.js';

const bodySchema = upsertExperimentBodySchema;
// Same shape the code creating the gate uses as a string literal, so a typo becomes a 400 here rather than a
// second experiment nothing ever reads.
const paramsSchema = z.object({
	name: z
		.string()
		.regex(/^[\da-z]+(?:-[\da-z]+)*$/)
		.max(64),
});

export type UpsertExperimentBody = z.input<typeof bodySchema>;
export type UpsertExperimentResult = ExperimentWithOverrides;

export default defineRoute({
	method: 'put',
	path: '/v3/experiments/:name',
	schema: {
		body: bodySchema,
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: true,
	}),
	async handler(req): Promise<UpsertExperimentResult> {
		const { name } = req.params;
		const { rangeStart, rangeEnd } = req.body;
		// Deduped rather than rejected: the same guild listed twice is a paste, not a mistake worth 400ing on,
		// and `experiment_overrides_guild_id_experiment_name_key` would otherwise turn it into a 500.
		const overrides = [...new Set(req.body.overrides)];
		const db = getContext().db;

		// One transaction because the overrides are declarative: a caller that meant "these three guilds" must
		// never be able to observe (or be left with) the delete having landed and the insert not.
		return db.begin(async (tx) => {
			const [experiment] = await tx<Experiments[]>`
				INSERT INTO experiments (name, range_start, range_end)
				VALUES (${name}, ${rangeStart}, ${rangeEnd})
				ON CONFLICT (name) DO UPDATE SET range_start = ${rangeStart}, range_end = ${rangeEnd}, updated_at = now()
				RETURNING *
			`;

			await tx`DELETE FROM experiment_overrides WHERE experiment_name = ${name}`;

			if (overrides.length > 0) {
				await tx`
					INSERT INTO experiment_overrides (guild_id, experiment_name)
					SELECT unnest(${overrides}::text[]), ${name}
				`;
			}

			return {
				name: experiment!.name as string,
				createdAt: experiment!.createdAt,
				updatedAt: experiment!.updatedAt,
				rangeStart: experiment!.rangeStart,
				rangeEnd: experiment!.rangeEnd,
				overrides,
			};
		});
	},
});
