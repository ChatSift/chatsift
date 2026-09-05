import type { Logger } from '@chatsift/backend-core';
import { traceDecision } from './decisionTrace.js';
import { discordErrors, moderationActions } from './metrics.js';

/**
 * Every side effect this bot can have on Discord. A closed set, because it is also a metric label -- adding a
 * kind of action is a deliberate edit here, not something a call site can invent.
 */
export type ModerationAction =
	'ban' | 'delete' | 'dm' | 'kick' | 'message' | 'mute' | 'role' | 'softban' | 'unban' | 'unmute' | 'webhook';

/**
 * What decided the action. Also a metric label, also closed. `command` is a moderator typing something;
 * `automod` is a native Discord AutoMod hit; `ladder` is an escalation rung; `scheduler` is a timed action
 * expiring; `observer` is us noticing a manual action taken through Discord's own UI; `gate` is the join gate
 * turning an account away at the door (P6, feature 13), which is the one source that decides on who somebody is
 * rather than on anything they did.
 */
export type ActionSource = 'automod' | 'command' | 'gate' | 'ladder' | 'observer' | 'report' | 'scheduler';

export interface ActionRequest {
	readonly action: ModerationAction;
	/**
	 * Which rule, ladder step or entry decided this. Flows into the decision trace, never into a metric label.
	 */
	readonly decidedBy?: string;
	/**
	 * Runs the actual Discord call -- the reason nothing else in this service is allowed to call REST for a side
	 * effect.
	 */
	execute(): Promise<void>;
	readonly guildId: string;
	readonly source: ActionSource;
	readonly targetId?: string;
}

/**
 * Coarse bucket for `discordErrors`, derived from the action rather than the URL so cardinality stays bounded
 * by this map instead of by however many guilds/members/messages get touched.
 */
const ROUTE_CLASS: Record<ModerationAction, string> = {
	ban: 'member',
	unban: 'member',
	softban: 'member',
	kick: 'member',
	mute: 'member',
	unmute: 'member',
	role: 'member',
	delete: 'message',
	// Posting or editing a message the bot owns -- the report card (P3). Distinct from `webhook` because a
	// failure means something different: a webhook 404 is a deleted log channel, a `message` 403 is the bot
	// lacking Send Messages in a channel it was pointed at.
	message: 'message',
	dm: 'user',
	webhook: 'webhook',
};

/**
 * The one seam every side-effecting Discord call goes through -- ban, kick, timeout, role change, message
 * delete, DM, webhook post. **Nothing else in this service may call REST for a side effect.**
 *
 * That rule is what makes this the single place that can guarantee every action is counted and traced, which is
 * the port's diagnosability bias (P7 re-audits every call site against exactly this), and it is why it exists
 * in P0 with the phases that need it still unwritten: retrofitting a chokepoint onto call sites that already
 * exist is the expensive version of this.
 *
 * A failed Discord call is rethrown rather than swallowed: the caller knows what a failure means for its own
 * flow (a case row to roll back, a reply to reword) and this does not. What it does own is counting it
 * honestly -- a rejected call increments `discordErrors`, never `moderationActions`, so an "actions taken"
 * panel can't quietly include actions Discord refused.
 *
 * **Two things are outside it on purpose**, written down here because P7's audit had to re-derive both:
 *
 * - **Interaction responses.** `api.interactions.reply`/`defer`/`editReply`/`followUp`/`createModal` are the
 *   acknowledgement channel for a moderator's own command, not something done *to* anybody -- they are
 *   addressed to the person who just pressed the button, expire with the token, and are almost all ephemeral.
 *   Routing them through here would drown `moderationActions` in replies and answer no question anyone asks.
 *   `message` is for a message the bot posts into a channel on its own account, which is the report card.
 * - **`services/api`.** It writes some of the same Discord objects from the dashboard (the report card, the
 *   mod-log embed on a case edit, report prompts, the log webhooks), in a different process with a different
 *   registry. That is a limit on what these counters mean rather than a call site to fix -- see the note on
 *   `moderationActions` in `metrics.ts`. Inside *this* service the rule is absolute.
 */
export async function executeAction(request: ActionRequest, logger: Logger): Promise<void> {
	const { action, guildId, source, targetId, decidedBy } = request;

	traceDecision(logger, {
		runner: source,
		action,
		guildId,
		...(targetId === undefined ? {} : { targetId }),
		...(decidedBy === undefined ? {} : { matched: decidedBy }),
	});

	try {
		await request.execute();
	} catch (error) {
		// `status` is what `DiscordAPIError`/`HTTPError` both carry; anything else is a transport failure with
		// no HTTP status of its own, which is still worth counting under a stable label.
		const status = String((error as { status?: number } | null | undefined)?.status ?? 'unknown');
		discordErrors.inc({ status, route_class: ROUTE_CLASS[action] });
		throw error;
	}

	// Counted only once Discord has accepted it -- see the doc comment.
	moderationActions.inc({ action, source });
}
