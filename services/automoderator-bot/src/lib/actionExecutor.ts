import type { Logger } from '@chatsift/backend-core';
import { traceDecision } from './decisionTrace.js';
import { resolveDryRun } from './dryRun.js';
import { discordErrors, dryRunSuppressions, moderationActions } from './metrics.js';

/**
 * Every side effect this bot can have on Discord. A closed set, because it is also a metric label -- adding a
 * kind of action is a deliberate edit here, not something a call site can invent.
 */
export type ModerationAction = 'ban' | 'delete' | 'dm' | 'kick' | 'mute' | 'role' | 'unban' | 'unmute' | 'webhook';

/**
 * What decided the action. Also a metric label, also closed. `command` is a moderator typing something;
 * `automod` is a native Discord AutoMod hit; `ladder` is an escalation rung; `scheduler` is a timed action
 * expiring; `observer` is us noticing a manual action taken through Discord's own UI.
 */
export type ActionSource = 'automod' | 'command' | 'ladder' | 'observer' | 'report' | 'scheduler';

export interface ActionRequest {
	readonly action: ModerationAction;
	/**
	 * Which rule, ladder step or entry decided this. Flows into the decision trace, never into a metric label.
	 */
	readonly decidedBy?: string;
	/**
	 * Runs the actual Discord call. **Only ever invoked in live mode** -- that is the entire contract, and the
	 * reason nothing else in this service is allowed to call REST for a side effect.
	 */
	execute(): Promise<void>;
	readonly guildId: string;
	/**
	 * Forces dry-run on for this one invocation (a command previewing what it would do). Cannot force it
	 * back off -- see `dryRun.ts`.
	 */
	readonly previewOnly?: boolean;
	readonly reason?: string;
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
	kick: 'member',
	mute: 'member',
	unmute: 'member',
	role: 'member',
	delete: 'message',
	dm: 'user',
	webhook: 'webhook',
};

export interface ActionResult {
	/**
	 * True when the side effect was suppressed. Callers that reply to a user branch on this to say "here's
	 * what I would have done" instead of "done".
	 */
	readonly suppressed: boolean;
}

/**
 * The one seam every side-effecting Discord call goes through -- ban, kick, timeout, role change, message
 * delete, DM, webhook post. **Nothing else in this service may call REST for a side effect.**
 *
 * That rule is what makes dry-run one flag rather than a hundred conditionals, and it is why this exists in P0
 * with the phases that need it still unwritten: retrofitting a chokepoint onto call sites that already exist
 * is the expensive version of this. It is also the single place that can guarantee every action is counted
 * and traced, which is the other half of the port's diagnosability bias (P7 re-audits every call site against
 * exactly this).
 *
 * Database writes are deliberately *not* routed through here. A dry run still persists the case it would have
 * filed, flagged `dry_run` -- see the roadmap's Dry-run section for why.
 *
 * A failed Discord call is rethrown rather than swallowed: the caller knows what a failure means for its own
 * flow (a case row to roll back, a reply to reword) and this does not. What it does own is counting it
 * honestly -- a rejected call increments `discordErrors`, never `moderationActions`, so an "actions taken"
 * panel can't quietly include actions Discord refused.
 */
export async function executeAction(request: ActionRequest, logger: Logger): Promise<ActionResult> {
	const { action, guildId, source, targetId, reason, decidedBy, previewOnly } = request;

	const suppressed = await resolveDryRun(guildId, previewOnly);

	traceDecision(logger, {
		runner: source,
		action,
		guildId,
		dryRun: suppressed,
		...(targetId === undefined ? {} : { targetId }),
		...(decidedBy === undefined ? {} : { matched: decidedBy }),
	});

	if (suppressed) {
		// Labelled `dry_run` rather than skipped entirely, so intent and enforcement sit on one axis: a panel
		// can show what the bot decided next to what it actually did.
		moderationActions.inc({ action, source, dry_run: 'true' });
		dryRunSuppressions.inc({ action });
		logger.info({ action, guildId, targetId, reason }, 'dry-run: suppressed a Discord side effect');
		return { suppressed: true };
	}

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
	moderationActions.inc({ action, source, dry_run: 'false' });

	return { suppressed: false };
}
