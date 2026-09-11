import { getContext, listAppealAnswers, listAppealEvents } from '@chatsift/backend-core';
import type { AppealAnswers, AppealEvents, Appeals } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import type { AppealWithUsers } from './util.js';
import { appealUserIds, attachAppealUsers, resolveUsersById } from './util.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	appealId: z.coerce.number().int().positive(),
});

export interface AppealEventWithActor extends AppealEvents {
	/**
	 * `null` for an event nobody took -- today only `MOOT`, which `GUILD_BAN_REMOVE` carries no actor for
	 * (P4b). Distinct from an id that failed to resolve, which comes back as the bare snowflake.
	 */
	actor: APIUser | Snowflake | null;
}

export interface GetAppealResult {
	/**
	 * In display order, each carrying the prompt as it read when it was answered (decision 7) rather than the
	 * guild's current wording -- so a questionnaire edited in P7 never rewrites what somebody was asked.
	 */
	answers: AppealAnswers[];
	appeal: AppealWithUsers;
	/**
	 * The whole trail, oldest first. Unbounded on purpose: an appeal takes one event on submission and one on
	 * the decision that closes it, and every decision is terminal, so there is nothing here to grow.
	 */
	events: AppealEventWithActor[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/appeals/queue/:appealId',
	schema: { params: paramsSchema },
	middleware: isAuthed({ fallthrough: false, isGlobalAdmin: false, isGuildManager: true }),
	async handler(req): Promise<GetAppealResult> {
		const { guildId, appealId } = req.params;
		const db = getContext().db;

		// Scoped by `guild_id` as well as by id, so an appeal id guessed from another guild's card 404s rather
		// than handing over a decision reason across servers -- `appeals.id` is one global sequence, not a
		// per-guild number like a case's.
		const [row] = await db<Appeals[]>`
			SELECT * FROM appeals WHERE guild_id = ${guildId} AND id = ${appealId}
		`;

		if (!row) {
			throw notFound('appeal not found');
		}

		const [answers, events] = await Promise.all([listAppealAnswers(row.id), listAppealEvents(row.id)]);

		// One set for the appeal and its trail together: the appellant submitted it and the moderator who decided
		// it wrote that event, so resolving the two independently would fetch both accounts twice.
		const ids = appealUserIds([row]);
		for (const event of events) {
			if (event.actorId) {
				ids.add(event.actorId);
			}
		}

		const usersById = await resolveUsersById(ids);
		const [appeal] = attachAppealUsers([row], usersById);

		return {
			appeal: appeal!,
			answers,
			events: events.map((event) => ({
				...event,
				actor: event.actorId ? (usersById.get(event.actorId) ?? event.actorId) : null,
			})),
		};
	},
});
