'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { queryKeys } from '@/api/queryClient';
import { Button } from '@/components/common/Button';
import { SvgRefresh } from '@/components/icons/SvgRefresh';

/**
 * Re-reads the guild's native AutoMod rules.
 *
 * Not `RefreshServerDataButton`: what goes stale here is the rule list, which has its own uncached route, not
 * the cached channel/role payload that button force-refreshes. Keywords are edited in Server Settings, so
 * coming back to a rule list from a minute ago is the normal path through this feature.
 */
export function RefreshRulesButton() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	return (
		<Button
			className="border border-solid border-on-primary px-4 py-2 text-secondary dark:border-on-primary-dark dark:text-secondary-dark"
			onPress={async () => {
				await queryClient.refetchQueries({ queryKey: queryKeys.automoderator.automodRules(guildId) });
			}}
		>
			<SvgRefresh />
			Refresh Rules
		</Button>
	);
}
