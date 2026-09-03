'use client';

import { useParams } from 'next/navigation';
import { DashboardCrumbs } from './DashboardCrumbs';
import { useAutomodRules, useBanwordPolicies } from '@/api/routes/automoderatorBanwords';

/**
 * Resolves the `automoderator/banned-words/[policyId]` segment to the AutoMod rule the policy hangs off.
 *
 * `rules` collapses the route's `available` discriminant to an empty list rather than leaving it undefined: a
 * guild where the bot can't read AutoMod rules is a settled answer, not a pending one, and the crumb has to
 * fall back to the policy number instead of showing its loading skeleton forever.
 */
export function AutomoderatorBanwordPolicyCrumbs() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: policies } = useBanwordPolicies(guildId);
	const { data: rulesResult } = useAutomodRules(guildId);

	return (
		<DashboardCrumbs
			segmentOptionsData={{
				automoderatorPolicies: policies,
				automodRules: rulesResult && (rulesResult.available ? rulesResult.rules : []),
			}}
		/>
	);
}
