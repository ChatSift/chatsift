import { getContext } from '@chatsift/backend-core';
import type { AutomoderatorBanwordPolicies } from '@chatsift/db';

/**
 * Which policy answers a native AutoMod hit (P5, feature 01).
 *
 * `scope` is carried rather than inferred from `policy.keyword` because it is what the decision trace and the
 * filter log both name: "the whole rule bans" and "this one word bans" are different sentences to show a
 * moderator asking why somebody was banned.
 */
export interface ResolvedBanwordPolicy {
	readonly policy: AutomoderatorBanwordPolicies;
	readonly scope: 'keyword' | 'rule';
}

/**
 * Resolves the policy for one `AUTO_MODERATION_ACTION_EXECUTION`, keyword-level winning over rule-level.
 *
 * That precedence is the whole reason a nullable keyword works: a guild says "this rule's whole list warns"
 * once, and then overrides the handful of words that should ban. At-least-specific-wins is the only ordering
 * where adding the override doesn't require removing the blanket rule first.
 *
 * `matched_keyword` is lowercased to meet the column, which `services/api` lowercases on write -- Discord's own
 * matching is case-insensitive, so `Foo` and `foo` are one keyword and storing both would be two policies
 * competing to answer one event. A `null` keyword on the event (a preset rule, or a trigger type that carries
 * no keyword at all) can therefore only ever resolve to the rule-level policy, which is exactly the case that
 * one exists for.
 *
 * Both candidates come back in one read: the rule's policy set is small by construction (the API caps it) and
 * two round trips per filter hit on the hottest path this product has would buy nothing.
 */
export async function resolveBanwordPolicy(
	guildId: string,
	ruleId: string,
	matchedKeyword: string | null,
): Promise<ResolvedBanwordPolicy | null> {
	const keyword = matchedKeyword?.toLowerCase() ?? null;

	const rows = await getContext().db<AutomoderatorBanwordPolicies[]>`
		SELECT * FROM automoderator_banword_policies
		WHERE guild_id = ${guildId}
			AND rule_id = ${ruleId}
			AND (keyword IS NULL OR keyword = ${keyword})
	`;

	const exact = rows.find((row) => row.keyword !== null);
	if (exact) {
		return { policy: exact, scope: 'keyword' };
	}

	const ruleLevel = rows.find((row) => row.keyword === null);
	return ruleLevel ? { policy: ruleLevel, scope: 'rule' } : null;
}
