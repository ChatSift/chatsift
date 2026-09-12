import type { AppealActor, AppealDeliveryResult, Logger } from '@chatsift/backend-core';
import {
	APPEAL_STATUS,
	applyAppealDecision,
	deliverAppealDecision,
	describeAppealDelivery,
	getAppeal,
	getContext,
} from '@chatsift/backend-core';
import { formatCaseUserTag } from '@chatsift/core';
import type { AppealStatus, Appeals } from '@chatsift/db';
import type { APIInteractionGuildMember, APIUser } from '@discordjs/core';
import { RESTJSONErrorCodes } from '@discordjs/core';
import { DiscordAPIError } from '@discordjs/rest';
import { refreshAppealCard } from './appealComponents.js';
import { botAppealDelivery } from './appealDelivery.js';
import { appealDecisions, appealDeliveries } from './metrics.js';

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
		// Only an approval touches Discord *from inside the claim*. P6's DM and re-add happen after it commits and
		// deliberately never reach `perform`: a DM Discord refused must not un-deny an appeal, and an unban that
		// already landed cannot be taken back by a failed delivery.
		...(decision === 'approved'
			? {
					async perform(claimed: Appeals) {
						await unban(claimed, moderator);
					},
				}
			: {}),
	});

	if (!result.ok) {
		appealDecisions.inc({ decision, outcome: result.reason, source: 'card' });

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
		// approval can reach this today -- but the branch stays, because the first person to put something else
		// behind `perform` would otherwise ship "check that I have Ban Members" as the failure text for a denial.
		return decision === 'approved'
			? 'I could not lift that ban, so the appeal has been left open. Check that I still have Ban Members here, then try again.'
			: 'Something went wrong recording that decision, so the appeal has been left open. Please try again.';
	}

	appealDecisions.inc({ decision, outcome: 'applied', source: 'card' });

	// Delivered *before* the card is redrawn, not after: the card renders `appeal_user_state.dm_reachable`, and
	// the delivery is what writes it. The other order leaves a card claiming a decision reached somebody it
	// bounced off, until the next thing happens to redraw it -- which for a decided appeal is never.
	const delivery = await deliverAppealDecision({ appeal: result.appeal, discord: botAppealDelivery(logger), logger });
	countDelivery(delivery);

	await refreshAppealCard(result.appeal, logger);

	switch (decision) {
		case 'approved':
			return `Approved. <@${appeal.userId}> has been unbanned. ${describeAppealDelivery(delivery)}`;
		case 'denied':
			return `Denied. ${describeAppealDelivery(delivery)}`;
		case 'denied_silent':
			return 'Denied silently. Their page still reads "under review", and it always will -- do not contact them about it.';
	}
}

/**
 * Split from the decision counter deliberately, and labelled per attempt: a denial that was decided and a
 * denial that reached the person it was about are two different successes, and `appeals_decisions_total` only
 * ever knew about the first.
 */
function countDelivery(delivery: AppealDeliveryResult): void {
	appealDeliveries.inc({ kind: 'dm', outcome: delivery.dm, source: 'card' });
	appealDeliveries.inc({ kind: 'rejoin', outcome: delivery.rejoin, source: 'card' });
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
