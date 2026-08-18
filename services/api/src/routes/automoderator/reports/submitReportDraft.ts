import {
	claimReportDraftToken,
	clearReportDraft,
	fileReport,
	releaseReportDraftToken,
	ReportFailure,
} from '@chatsift/backend-core';
import { automoderatorReportsChannel } from '@chatsift/core';
import { badRequest, conflict, forbidden } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { fetchMeForSession, isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { resolveCandidateGuilds, resolveDraftForSession } from './draftUtil.js';
import { postReportCard } from './reportCard.js';

const paramsSchema = z.object({ token: z.uuid() });

/**
 * The reason cap matches what a reporter can type into the guild context menu's modal, so the two intake paths
 * can't disagree about what fits on a card.
 */
const bodySchema = z.object({
	guildId: snowflakeSchema,
	reason: z.string().trim().min(1).max(1_000),
});

export type SubmitReportDraftBody = z.input<typeof bodySchema>;

export interface SubmitReportDraftResult {
	/**
	 * True when this joined a report that already existed rather than opening one -- which for a DM report means
	 * somebody else has already reported the same message into the same server.
	 */
	joined: boolean;
	reportId: number;
}

export default defineRoute({
	method: 'post',
	path: '/v3/automoderator/report-drafts/:token',
	schema: { body: bodySchema, params: paramsSchema },
	// See `getReportDraft.ts` for why this is a full OAuth session only.
	middleware: isAuthed({ allowScopedSession: false, fallthrough: false, isGlobalAdmin: false, isGuildManager: false }),
	realtimeChannel: (req) => automoderatorReportsChannel(req.body.guildId),
	async handler(req, res): Promise<SubmitReportDraftResult> {
		const me = await fetchMeForSession(req.tokens.access, req.logger, res);
		const { split, reporter } = await resolveDraftForSession(req.params.token, me);

		// Re-resolved rather than trusted from the body. The picker is a convenience; this is the check. Without
		// it the endpoint would file a report into any guild id a caller cared to name, which is precisely the
		// cross-server surveillance tool the "DM contexts only" rule exists to prevent.
		const candidates = await resolveCandidateGuilds(me, split.target.id, req.logger);
		if (!candidates.some((guild) => guild.id === req.body.guildId)) {
			throw forbidden('that server is not accepting this report');
		}

		// Claimed *before* the write and only *after* the checks above. Two concurrent submissions of the same
		// token would otherwise both resolve the draft and both file it -- into two different guilds, since
		// `fileReport` dedupes per guild and has no reason to refuse the second. One draft is one report, and
		// this atomic `DEL` is what makes that true rather than merely likely.
		if (!(await claimReportDraftToken(req.params.token))) {
			throw conflict('this report has already been submitted');
		}

		let result;
		try {
			result = await fileReport({
				guildId: req.body.guildId,
				origin: 'DM',
				target: split.target,
				reporter,
				reason: req.body.reason,
				message: {
					messageId: split.subject.messageId,
					channelId: split.subject.channelId,
					content: split.subject.content,
					imageUrl: split.subject.imageUrl,
				},
				contextMessages: split.contextMessages,
			});
		} catch (error) {
			// The claim is released on *every* failure path, so a refusal or a transient database error costs the
			// reporter a retry rather than their draft. Nothing was written, so there is nothing to be idempotent
			// about -- the token going back is what lets them try a different server.
			await releaseReportDraftToken(req.params.token, me.id);

			// A refusal is an ordinary outcome, not a server fault: "you already reported this" and "a moderator
			// already reviewed it" are both things the page should say back plainly.
			if (error instanceof ReportFailure) {
				throw badRequest(error.message, { refusal: error.refusal });
			}

			throw error;
		}

		// The draft goes only now, after the write landed: it is what stops the *next* `/submit-report` re-filing
		// a conversation the reporter has already dealt with. The token is already gone -- it was the claim.
		await clearReportDraft(me.id);

		await postReportCard(result.report, result.reporterCount);

		return { reportId: result.report.id, joined: result.joined };
	},
});
