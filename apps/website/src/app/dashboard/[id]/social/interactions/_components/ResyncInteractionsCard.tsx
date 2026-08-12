'use client';

import { useParams } from 'next/navigation';
import { useResyncSocialInteractions } from '@/api/routes/social';
import type { ResyncOutcome } from '@/components/dashboard/ResyncCard';
import { ResyncCard } from '@/components/dashboard/ResyncCard';

/**
 * `alwaysVisible`, unlike ModMail's two resync cards: a command id belongs to the application that minted it,
 * and every interaction migrated out of legacy Social lands with none at all (#343 ledger item 3), so this is
 * the one-click repair an ordinary guild is expected to need once after the cutover.
 */
export function ResyncInteractionsCard() {
	const { id: guildId } = useParams<{ id: string }>();
	const resyncInteractions = useResyncSocialInteractions(guildId);

	const resync = async (): Promise<ResyncOutcome> => {
		const result = await resyncInteractions.mutateAsync();

		return {
			failures: result.failures,
			summary:
				`Done - ${result.interactionsRecreated} command${result.interactionsRecreated === 1 ? '' : 's'} recreated, ` +
				`${result.staleCommandsDeleted} stale command${result.staleCommandsDeleted === 1 ? '' : 's'} removed.`,
		};
	};

	return (
		<ResyncCard
			alwaysVisible
			description="Re-registers every interaction below as a slash command in this server, and removes any leftover command that no longer backs one. Run it if an interaction stops responding, or after this server moves between Social deployments. Safe to run any time; anything already correct is left alone."
			resync={resync}
		/>
	);
}
