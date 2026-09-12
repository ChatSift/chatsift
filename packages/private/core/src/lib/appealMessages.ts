import { truncate } from './discordText.js';

/**
 * What an appellant is actually told, and how (#232 P6, §6).
 *
 * Plain message content rather than an embed, deliberately: this arrives in a DM from an application the
 * appellant user-installed on `unban.app` and nowhere else, so there is no guild branding to carry and nothing
 * to disambiguate it from -- and a wall of embed chrome around two sentences reads as a newsletter rather than
 * as an answer to something they asked for.
 *
 * Lives here rather than in either service because **both mod surfaces deliver** (decision 1): the card's
 * buttons send this from `services/appeals-bot` and the dashboard sends it from `services/api`, and two copies
 * of the wording is two places for the denial reason to be framed differently.
 */

/**
 * Discord caps message content at 2000. The reason is already bounded by `APPEAL_DECISION_REASON_MAX_LENGTH`
 * (500) and the guild name by Discord's own 100, so this only ever bites on a hostile guild name -- the cap is
 * here so that it truncates rather than 400ing the send.
 */
const CONTENT_LIMIT = 2_000;

/**
 * What happened to the appellant's membership on an approval, which is what decides the second half of the
 * message.
 *
 * - `added` -- decision 14's three-sided opt-in was satisfied and they are back in the guild already.
 * - `invited` -- one of the three sides said no, or the add failed, and the DM carries an invite instead.
 * - `none` -- there was no invite to offer either (Appeals cannot create one there), so the message says only
 *   that the ban is lifted. Never dressed up: telling somebody to "head back in" with nothing to click is
 *   worse than telling them the truth.
 */
export type AppealRejoinOutcome = 'added' | 'invited' | 'none';

export interface AppealDecisionMessageOptions {
	/**
	 * What the guild is called. Absent for a guild Discord would not describe to us, which renders as "the
	 * server you appealed to" rather than as a bare id -- an appellant has no use for a snowflake.
	 */
	readonly guildName?: string | null;
	/**
	 * Set only alongside `rejoin: 'invited'`.
	 */
	readonly inviteURL?: string | null;
	/**
	 * The moderator's words, and the entire substance of a denial. Never sent on an approval: the route and the
	 * card both refuse a reason there (P5), so there is nothing to render.
	 */
	readonly reason?: string | null;
	readonly rejoin?: AppealRejoinOutcome;
}

function guildLabel(guildName?: string | null): string {
	return guildName?.trim().length ? `**${guildName.trim()}**` : 'the server you appealed to';
}

/**
 * The approval DM.
 *
 * Says what was decided before it says what to do about it, because the first line is what shows in a
 * notification preview and "you were unbanned" is the part somebody has been waiting on.
 */
function buildApproved(options: AppealDecisionMessageOptions): string {
	const where = guildLabel(options.guildName);
	const parts = [`Your appeal was **approved** -- you are no longer banned from ${where}.`];

	switch (options.rejoin ?? 'none') {
		case 'added':
			parts.push('You have already been added back, so you should find it in your server list again.');
			break;
		case 'invited':
			// The invite is single-use and short-lived (see the callers), which is worth saying: an appellant who
			// sits on it for a fortnight and finds it dead should know that was the design and not a second ban.
			if (options.inviteURL) {
				parts.push(`Here is your way back in: ${options.inviteURL}\n\nIt only works once, and not for long.`);
			}

			break;
		case 'none':
			parts.push('You will need an invite to rejoin -- the server did not give me one to pass on.');
			break;
	}

	return parts.join('\n\n');
}

/**
 * The denial DM.
 *
 * A reason is not optional in practice -- both surfaces require one on a denial the appellant can see -- but it
 * is optional here, because a missing one must degrade to a decision they were still told about rather than to
 * a message that never sends. A **silent** denial does not reach this function at all; the caller branches
 * before it (decision 6).
 */
function buildDenied(options: AppealDecisionMessageOptions): string {
	const where = guildLabel(options.guildName);
	const parts = [`Your appeal to ${where} was **denied**, so the ban stands.`];

	if (options.reason?.trim().length) {
		// Blockquoted rather than fenced, unlike the card: this is a moderator's sentence being handed back to
		// the person it is about, and a code block makes an explanation look like a log line. Nothing here is
		// attacker-controlled -- the reason was typed by a moderator into their own guild's modal.
		parts.push(`> ${options.reason.trim().replaceAll('\n', '\n> ')}`);
	}

	parts.push('This message is not monitored -- replying to it reaches nobody.');

	return parts.join('\n\n');
}

export function buildAppealDecisionMessage(
	status: 'APPROVED' | 'DENIED',
	options: AppealDecisionMessageOptions = {},
): string {
	return truncate(status === 'APPROVED' ? buildApproved(options) : buildDenied(options), CONTENT_LIMIT);
}
