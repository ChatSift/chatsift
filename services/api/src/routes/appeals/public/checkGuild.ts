import { getContext } from '@chatsift/backend-core';
import type { AppealAnswers } from '@chatsift/db';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAppealsAuthed } from '../../../middleware/isAppealsAuthed.js';
import type { AppealBlockReason } from '../../../util/appealsEligibility.js';
import { APPEAL_KIND_BAN, evaluateAppealEligibility } from '../../../util/appealsEligibility.js';
import type { PublicAppeal } from '../../../util/appealsPublic.js';
import { toPublicAppeal } from '../../../util/appealsPublic.js';
import type { GuildSummary } from '../../../util/guildSummary.js';
import { fetchGuildSummary } from '../../../util/guildSummary.js';
import { snowflakeSchema } from '../../../util/schemas.js';

const paramsSchema = z.object({ guildId: snowflakeSchema });

export interface AppealFormQuestion {
	id: number;
	position: number;
	prompt: string;
	required: boolean;
}

export interface CheckGuildResult {
	/**
	 * Against the ban they are under now, not their whole history in this guild -- see
	 * `appealsForCurrentPunishment`. An earlier ban that was lifted took its appeals with it, which is what
	 * `BlockedNotice`'s "the same ban" copy has always promised.
	 */
	appealsUsed: number;
	/**
	 * `null` when nothing is stopping them -- which is the only state that renders the form.
	 */
	blocked: AppealBlockReason | null;
	/**
	 * ISO timestamp, set only alongside `blocked: 'COOLDOWN'`.
	 */
	cooldownUntil: string | null;
	/**
	 * `null` for a guild that does not use Appeals, or one the bot can no longer see. Both render as "this
	 * server does not accept appeals here" rather than an error -- see `fetchGuildSummary`.
	 */
	guild: GuildSummary | null;
	/**
	 * The appeal this page is about, through the §5 serializer: their most recent one against the ban they are
	 * under now, or -- where they are not banned -- the one that ended their last ban. Present regardless of
	 * `blocked`, because the commonest reason to open this page at all is to check on one.
	 *
	 * Never an appeal about a ban that has since been lifted while they sit under a new one. That combination
	 * rendered as "Your appeal: Approved" over a form for a ban nobody had appealed yet.
	 */
	latestAppeal: PublicAppeal | null;
	maxAppeals: number | null;
	questions: AppealFormQuestion[];
}

export default defineRoute({
	method: 'get',
	path: '/v3/appeals/guilds/:guildId',
	schema: {
		params: paramsSchema,
	},
	middleware: isAppealsAuthed({ fallthrough: false }),
	async handler(req): Promise<CheckGuildResult> {
		const { guildId } = req.params;
		const { sub } = req.appellant;

		// `'BAN'` rather than a parameter: nothing can appeal a timeout until P9, and a `kind` the caller picks
		// would be a way to ask about a punishment shape the product does not serve yet.
		const eligibility = await evaluateAppealEligibility(guildId, sub, APPEAL_KIND_BAN, req.logger);

		// Skipped entirely for a guild with no settings row, which is what keeps a wrong-guild deep link (or a
		// scan of them) from costing a Discord call each.
		const guild = eligibility.settings ? await fetchGuildSummary(guildId, 'APPEALS') : null;

		// Their own answers, so an appellant checking back can read what they actually wrote rather than only
		// that something is pending. `prompt_snapshot` means they see the question as it was asked, even if the
		// guild has since edited its form (decision 7).
		const answers = eligibility.latestAppeal
			? await getContext().db<AppealAnswers[]>`
					SELECT * FROM appeal_answers WHERE appeal_id = ${eligibility.latestAppeal.id} ORDER BY position ASC
				`
			: [];

		return {
			guild,
			blocked: eligibility.settings && !guild ? 'NOT_CONFIGURED' : eligibility.blocked,
			questions: eligibility.questions.map(({ id, position, prompt, required }) => ({
				id,
				position,
				prompt,
				required,
			})),
			latestAppeal: eligibility.latestAppeal
				? toPublicAppeal(
						eligibility.latestAppeal,
						answers.map(({ position, promptSnapshot, answer }) => ({ position, promptSnapshot, answer })),
					)
				: null,
			appealsUsed: eligibility.appealsUsed,
			maxAppeals: eligibility.settings?.maxAppeals ?? null,
			cooldownUntil: eligibility.cooldownUntil?.toISOString() ?? null,
		};
	},
});
