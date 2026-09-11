import type { AppealActor, Logger } from '@chatsift/backend-core';
import { APPEAL_STATUS, applyAppealDecision, getAppeal, getContext } from '@chatsift/backend-core';
import { formatCaseUserTag } from '@chatsift/core';
import type { AppealStatus, Appeals } from '@chatsift/db';
import type { APIInteractionGuildMember, APIUser } from '@discordjs/core';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { refreshAppealCard } from './appealComponents.js';
import { appealDecisions } from './metrics.js';

export function actorFromUser(user: APIUser): AppealActor {
	return { id: user.id, tag: formatCaseUserTag(user) };
}

/**
 * How a decision is labelled in metrics. A silent denial is its own value rather than a flag, because "how many
 * of this guild's denials are silent" is the question anybody looking at this counter is actually asking.
 */
export type AppealDecisionName = 'approved' | 'denied_silent' | 'denied' | 'moot';

/**
 * The three a moderator can click. `moot` is the system closing an appeal whose ban was lifted elsewhere (P4b,
 * `banEvents.ts`) -- it goes straight to `applyAppealDecision` with no actor, no Discord call and nothing to
 * reply to, so it never reaches {@link runAppealDecision}.
 */
export type AppealButtonDecision = Exclude<AppealDecisionName, 'moot'>;

export interface RunAppealDecisionOptions {
	readonly appeal: Appeals;
	readonly decision: AppealButtonDecision;
	readonly member: APIInteractionGuildMember;
	readonly reason: string | null;
}

const STATUS_FOR: Record<AppealButtonDecision, AppealStatus> = {
	approved: APPEAL_STATUS.APPROVED,
	denied: APPEAL_STATUS.DENIED,
	denied_silent: APPEAL_STATUS.DENIED,
};

/**
 * Takes a decision on an appeal and reports back the one line to show the moderator.
 *
 * The transition itself is `applyAppealDecision` in `@chatsift/backend-core`, shared with the dashboard
 * (decision 1): this function is the Discord half around it -- the unban an approval performs, the card
 * redraw, the counter, and the copy.
 */
export async function runAppealDecision(options: RunAppealDecisionOptions, logger: Logger): Promise<string> {
	const { appeal, decision, member, reason } = options;
	const moderator = actorFromUser(member.user);

	const result = await applyAppealDecision({
		appealId: appeal.id,
		status: STATUS_FOR[decision],
		silent: decision === 'denied_silent',
		moderator,
		reason,
		// Only an approval touches Discord. A denial writes a row and redraws a card, and P6 is what turns the
		// non-silent kind into a DM -- there is nothing to undo if it fails, which is why `perform` is absent.
		...(decision === 'approved'
			? {
					async perform(claimed: Appeals) {
						await unban(claimed, moderator);
					},
				}
			: {}),
	});

	if (!result.ok) {
		appealDecisions.inc({ decision, outcome: result.reason });

		if (result.reason === 'raced') {
			// Their card is stale by definition if they lost the race, so redraw it from the row they lost to.
			const current = await getAppeal(appeal.id);
			if (current) {
				await refreshAppealCard(current, logger);
			}

			return 'Someone else decided this appeal first, so nothing was done.';
		}

		logger.error(
			{ err: result.error, guildId: appeal.guildId, appealId: appeal.id, decision },
			'failed to carry out an appeal decision',
		);

		// Keyed to the decision rather than assuming an unban. Only an approval passes `perform`, so only an
		// approval can reach this at all today -- but P6 gives denials a DM, and the first person to reach for
		// `perform` to send it would otherwise ship "check that I have Ban Members" as the failure text for a
		// denial. (P6 should *not* do that, for the reason on `perform` itself: a DM that could not be delivered
		// must not un-deny an appeal.)
		return decision === 'approved'
			? 'I could not lift that ban, so the appeal has been left open. Check that I still have Ban Members here, then try again.'
			: 'Something went wrong recording that decision, so the appeal has been left open. Please try again.';
	}

	appealDecisions.inc({ decision, outcome: 'applied' });
	await refreshAppealCard(result.appeal, logger);

	switch (decision) {
		case 'approved':
			return `Approved. <@${appeal.userId}> has been unbanned.`;
		case 'denied':
			return 'Denied. They will see the decision on their appeal page.';
		case 'denied_silent':
			return 'Denied silently. Their page still reads "under review", and it always will -- do not contact them about it.';
	}
}

/**
 * Lifts the ban an approval was about.
 *
 * `Unknown Ban` is success, not failure: somebody unbanning them by hand while the appeal sat open is a
 * perfectly ordinary way for a guild to work, and the end state this call exists to reach is already true.
 * Anything else throws, which hands the claim back and leaves the appeal open -- see
 * `applyAppealDecision` for why that ordering is not negotiable.
 */
async function unban(appeal: Appeals, moderator: AppealActor): Promise<void> {
	const api = getContext().service.client.api;

	try {
		await api.guilds.unbanUser(appeal.guildId, appeal.userId, {
			reason: `Appeal ${appeal.id} approved by ${moderator.tag}`,
		});
	} catch (error) {
		if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownBan) {
			return;
		}

		throw error;
	}
}
