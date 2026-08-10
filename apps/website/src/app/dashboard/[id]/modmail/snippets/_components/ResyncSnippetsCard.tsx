'use client';

import { useParams } from 'next/navigation';
import { useResyncModmailSnippets } from '@/api/routes/modmail';
import type { ResyncOutcome } from '@/components/dashboard/ResyncCard';
import { ResyncCard } from '@/components/dashboard/ResyncCard';

/**
 * Moved here from the Config page (#302) since snippet commands are the thing most commonly out of sync after
 * a custom-instance swap, then narrowed to snippets only in #331 -- panels have their own card on their own
 * page now.
 */
export function ResyncSnippetsCard() {
	const params = useParams<{ id: string }>();
	const resyncSnippets = useResyncModmailSnippets(params.id);

	const resync = async (): Promise<ResyncOutcome> => {
		const result = await resyncSnippets.mutateAsync();

		return {
			failures: result.failures,
			summary:
				`Done - ${result.snippetsRecreated} snippet command${result.snippetsRecreated === 1 ? '' : 's'} recreated, ` +
				`${result.staleCommandsDeleted} stale command${result.staleCommandsDeleted === 1 ? '' : 's'} removed.`,
		};
	};

	return (
		<ResyncCard
			description="Recreates any snippet command that belongs to an application that no longer owns this server, and removes any leftover commands that no longer back a snippet - needed after moving this server onto or off of a custom ModMail instance. Safe to run any time; anything already correct is left alone."
			resync={resync}
		/>
	);
}
