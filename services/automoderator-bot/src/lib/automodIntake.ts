import { getContext } from '@chatsift/backend-core';
import type { Client } from '@discordjs/core';
import { GatewayDispatchEvents } from '@discordjs/core';
import { traceDecision } from './decisionTrace.js';
import { automodEvents } from './metrics.js';

/**
 * Intake for Discord's own AutoMod (`AUTO_MODERATION_ACTION_EXECUTION`), which is the single riskiest
 * assumption in the whole port: feature 01 delegates *matching* to Discord and keeps only the *response*,
 * keying policy on `matched_keyword` so legacy's per-word flag model survives. If that field doesn't arrive
 * usable, feature 01's design changes and P5 gets rescoped — which is why this lands in P0 rather than P5.
 *
 * At P0 this only observes: it counts what arrives and writes a decision trace carrying enough to answer "did
 * the round trip work". `automoderator_banword_policies` and the response layer are P5's.
 *
 * **Nothing arrives at all** if the guild has no native keyword rules, or if the `AutoModerationExecution`
 * intent isn't granted. Both are silent — hence the counter, whose flat-zero is the port's most likely
 * undetected failure.
 */
export function registerAutomodIntake(client: Client): void {
	client.on(GatewayDispatchEvents.AutoModerationActionExecution, ({ data }) => {
		const logger = getContext().logger.child({
			event: 'autoModerationActionExecution',
			guildId: data.guild_id,
			ruleId: data.rule_id,
		});

		const matchedKeyword = data.matched_keyword ?? null;

		automodEvents.inc({
			action_type: String(data.action.type),
			matched: String(matchedKeyword !== null),
		});

		// `matched_keyword` is the join key policy rows will use, so it goes in the trace. `matched_content`
		// deliberately does not: that's the member's own message text, and this line ends up in a log
		// aggregator.
		traceDecision(logger, {
			runner: 'automod',
			action: null,
			guildId: data.guild_id,
			targetId: data.user_id,
			...(matchedKeyword === null ? {} : { matched: matchedKeyword }),
		});
	});
}
