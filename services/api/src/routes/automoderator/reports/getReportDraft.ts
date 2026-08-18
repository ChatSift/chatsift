import type { APIUser, Snowflake } from '@discordjs/core';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { fetchMeForSession, isAuthed } from '../../../middleware/isAuthed.js';
import { discordAPIAutomoderator } from '../../../util/discordAPI.js';
import { resolveDiscordUser } from '../../../util/users.js';
import type { ReportCandidateGuild } from './draftUtil.js';
import { resolveCandidateGuilds, resolveDraftForSession } from './draftUtil.js';

const paramsSchema = z.object({ token: z.uuid() });

/**
 * One captured message as the confirmation page shows it back. Deliberately the reporter's *own* draft being
 * played back to them, so there is nothing here they haven't already seen -- the authorization that matters
 * happened in `resolveDraftForSession`.
 */
export interface ReportDraftMessagePreview {
	authorId: string;
	authorTag: string;
	content: string | null;
	imageUrl: string | null;
	isSubject: boolean;
	messageId: string;
	timestamp: string;
}

export interface GetReportDraftResult {
	/**
	 * The servers this may be filed into. Empty is an ordinary outcome, not an error: the page says so and
	 * offers nothing to confirm.
	 */
	guilds: ReportCandidateGuild[];
	messages: ReportDraftMessagePreview[];
	target: APIUser | Snowflake;
}

export default defineRoute({
	method: 'get',
	path: '/v3/automoderator/report-drafts/:token',
	schema: { params: paramsSchema },
	// A real session is required, and the draft is then bound to *which* session -- see
	// `resolveDraftForSession`. `isGuildManager` is deliberately false: a reporter is an ordinary member, and
	// requiring manage rights would make the feature available only to the staff who least need it.
	// `allowScopedSession: false` because a `/dashboard` link's session belongs to one guild's moderator, and a
	// DM draft is a personal thing that has not chosen a guild yet.
	middleware: isAuthed({ allowScopedSession: false, fallthrough: false, isGlobalAdmin: false, isGuildManager: false }),
	async handler(req, res): Promise<GetReportDraftResult> {
		const me = await fetchMeForSession(req.tokens.access, req.logger, res);
		const { draft, split } = await resolveDraftForSession(req.params.token, me);

		const [target, guilds] = await Promise.all([
			resolveDiscordUser(discordAPIAutomoderator, split.target.id),
			resolveCandidateGuilds(me, split.target.id, req.logger),
		]);

		return {
			target,
			guilds,
			messages: draft.messages.map((message) => ({
				messageId: message.messageId,
				authorId: message.author.id,
				authorTag: message.author.tag,
				content: message.content,
				imageUrl: message.imageUrl,
				timestamp: message.timestamp,
				// Flagged rather than reordered, so the page can show the reporter which message will headline the
				// report while still listing everything in the order they added it.
				isSubject: message.messageId === split.subject.messageId,
			})),
		};
	},
});
