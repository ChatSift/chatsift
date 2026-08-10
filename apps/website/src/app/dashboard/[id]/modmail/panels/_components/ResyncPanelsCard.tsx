'use client';

import { useParams } from 'next/navigation';
import { useResyncModmailPanels } from '@/api/routes/modmail';
import type { ResyncOutcome } from '@/components/dashboard/ResyncCard';
import { ResyncCard } from '@/components/dashboard/ResyncCard';

/**
 * The panel half of #216 P6's resync, split out of the Snippets page's card in #331 so reposting panels
 * doesn't also churn every snippet command (and so it lives on the page it's actually about).
 */
export function ResyncPanelsCard() {
	const params = useParams<{ id: string }>();
	const resyncPanels = useResyncModmailPanels(params.id);

	const resync = async (): Promise<ResyncOutcome> => {
		const result = await resyncPanels.mutateAsync();

		return {
			failures: result.failures,
			summary: `Done - ${result.panelsReposted} panel${result.panelsReposted === 1 ? '' : 's'} reposted.`,
		};
	};

	return (
		<ResyncCard
			description="Reposts any panel message that belongs to an application that no longer owns this server - needed after moving this server onto or off of a custom ModMail instance. Safe to run any time; a panel that's already posted by the right application is left alone."
			resync={resync}
		/>
	);
}
