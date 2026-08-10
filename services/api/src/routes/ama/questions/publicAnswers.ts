import { getContext } from '@chatsift/backend-core';
import { amaPublicAnswersChannel } from '@chatsift/core';
import type { AmaQuestions, AmaSessions } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { CDNRoutes, ImageFormat, RouteBases } from '@discordjs/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { resolveAmaUser } from './util.js';

const paramsSchema = z.object({
	shareToken: z.string().min(1),
});

export interface PublicUserInfo {
	avatarUrl: string | null;
	displayName: string;
}

export interface PublicAnsweredQuestion {
	answerContent: string | null;
	answerImageUrl: string | null;
	answeredBy: PublicUserInfo | null;
	askedAt: Date;
	author: PublicUserInfo;
	content: string;
	id: number;
}

/**
 * Reduces a resolved Discord user down to just what the public page is allowed to show -- never the
 * raw snowflake (see this route's own doc comment), only a display name + avatar. `resolveAmaUser`'s
 * bare-snowflake fallback (an unresolvable/404'd user) renders as "Unknown User" with no avatar
 * instead of leaking the id it couldn't resolve.
 */
function toPublicUserInfo(resolved: APIUser | Snowflake): PublicUserInfo {
	if (typeof resolved === 'string') {
		return { avatarUrl: null, displayName: 'Unknown User' };
	}

	return {
		avatarUrl: resolved.avatar
			? `${RouteBases.cdn}${CDNRoutes.userAvatar(resolved.id, resolved.avatar, ImageFormat.PNG)}`
			: null,
		displayName: resolved.global_name ?? resolved.username,
	};
}

export interface PublicAnswersResult {
	questions: PublicAnsweredQuestion[];
	/**
	 * WS gateway channel this page's data is invalidated on (#323). Handed back by the server rather than
	 * derived client-side because `amaPublicAnswersChannel` needs the ama id, and the whole point of this
	 * route is that the viewer only ever knows the share token.
	 */
	realtimeChannel: string;
	title: string;
}

/**
 * Unauthenticated, read-only mirror of an AMA's answers channel (#293 follow-up) -- for people
 * without server access to still read what was asked/answered. Only ever returns `ASKED` questions
 * (the only state meaning "actually posted"); nothing pending/approved/denied ever leaks through
 * here, and raw Discord ids are never exposed, same convention as the answers channel itself
 * (`getBaseEmbeds`'s `includeUserId: false` default).
 *
 * Also requires `answer_content IS NOT NULL` -- with `prepared_answers_enabled` off (still the common
 * case), a question's answer is only ever given live on stream/voice and never typed anywhere, so this
 * page would otherwise be a wall of questions with no answers next to them. A question with nothing
 * recorded here has nothing useful for this page to show.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/ama/public/:shareToken',
	schema: {
		params: paramsSchema,
	},
	async handler(req): Promise<PublicAnswersResult> {
		const { shareToken } = req.params;
		const db = getContext().db;

		const [session] = await db<AmaSessions[]>`
			SELECT * FROM ama_sessions WHERE share_token = ${shareToken}
		`;

		if (!session) {
			throw notFound('AMA not found');
		}

		const questions = await db<AmaQuestions[]>`
			SELECT * FROM ama_questions
			WHERE ama_id = ${session.id} AND state = 'ASKED' AND answer_content IS NOT NULL
			ORDER BY created_at ASC
		`;

		// Dedup'd the same way `listQuestions.ts` resolves authors -- several questions on this page can
		// easily share an author or an answerer (or the same user can be both across different questions).
		const userIds = new Set<string>();
		for (const question of questions) {
			userIds.add(question.authorId);
			if (question.answeredById) {
				userIds.add(question.answeredById);
			}
		}

		const resolvedEntries = await Promise.all(
			[...userIds].map(async (userId): Promise<[string, APIUser | Snowflake]> => [
				userId,
				await resolveAmaUser(session.guildId, userId),
			]),
		);
		const resolvedById = new Map(resolvedEntries);

		const resolved = questions.map((question): PublicAnsweredQuestion => {
			const answeredByResolved = question.answeredById ? resolvedById.get(question.answeredById) : undefined;

			return {
				answerContent: question.answerContent,
				answerImageUrl: question.answerImageUrl,
				answeredBy: answeredByResolved ? toPublicUserInfo(answeredByResolved) : null,
				// `asked_at`, not `updated_at`: since #327 an already-sent answer can still be edited, and
				// every such edit bumps `updated_at` -- reading it here would move a months-old question's
				// displayed date to whenever someone last fixed a typo in its answer. The `??` only covers
				// rows the migration's backfill left null (there shouldn't be any -- it filled every 'ASKED'
				// row, which is all this route selects -- but the column is nullable, so it has to narrow).
				askedAt: question.askedAt ?? question.updatedAt,
				author: toPublicUserInfo(resolvedById.get(question.authorId)!),
				content: question.content,
				id: question.id,
			};
		});

		return { questions: resolved, realtimeChannel: amaPublicAnswersChannel(session.id), title: session.title };
	},
});
