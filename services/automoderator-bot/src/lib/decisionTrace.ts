import type { Logger } from '@chatsift/backend-core';

/**
 * One structured line carrying the full reason chain behind a decision.
 *
 * Legacy AutoModerator logged *outcomes*; the gap that cost the most time was always **why** something didn't
 * fire. Every field below is optional because a trace is written at whatever point the chain stopped -- a
 * decision that ended at a bypass role has no ladder position, and saying so by omission is more honest than
 * filling it in.
 *
 * Deliberately not an event a human reads in Discord: this is `logger.info` structured data, queryable in
 * dozzle by `guildId` and `feature`. Feature 33's user-facing filter log is a different thing entirely.
 */
export interface DecisionTrace {
	/**
	 * What was done, or `null` for "nothing" -- which is the case worth tracing.
	 */
	action: string | null;
	/**
	 * The bypass role that stopped this, if one did.
	 */
	bypassRoleId?: string;
	/**
	 * Whether the action was suppressed by dry-run. Present whenever `action` is non-null.
	 */
	dryRun?: boolean;
	/**
	 * The exemption that stopped this, if one did.
	 */
	exemption?: string;
	/**
	 * The experiment gate consulted, and what it said.
	 */
	gate?: { enabled: boolean; name: string };
	guildId: string;
	/**
	 * The status that stopped this: the target is the guild owner, or holds Administrator or Manage Messages.
	 * Distinct from `bypassRoleId`, which is configuration rather than status -- and the distinction is the
	 * whole answer to "why wasn't this deleted", since only one of the two can be changed by editing a list.
	 */
	immunity?: string;
	/**
	 * Ladder position at the time of the decision, once ladders exist (P2/P5).
	 */
	ladderCount?: number;
	/**
	 * Which entry (banned word, allowlist row, ladder step) matched. Never the matched *content* -- that is
	 * user text, and this line ends up in a log aggregator.
	 */
	matched?: string;
	/**
	 * The runner or subsystem that made the decision.
	 */
	runner: string;
	targetId?: string;
}

/**
 * Emits a decision trace. Always `info`, never `debug`: a decision that can't be explained after the fact is
 * the failure this exists to prevent, and a level nobody enables in production would not prevent it.
 */
export function traceDecision(logger: Logger, trace: DecisionTrace): void {
	logger.info({ decision: trace }, `automoderator decision: ${trace.runner} -> ${trace.action ?? 'no action'}`);
}
