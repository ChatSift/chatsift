'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FaExclamationTriangle } from 'react-icons/fa';
import { useMe } from '@/api/routes/auth';
import type { ResyncModmailResult } from '@/api/routes/modmail';
import { useResyncModmail } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';

/**
 * Resync (#216 P6) is only ever needed around a custom-instance swap, so it stays hidden for a normal guild
 * -- a global admin can still reach it anywhere, since they're the one who'd actually perform a swap and may
 * need to run it for a guild they don't otherwise manage day-to-day. Moved here from the Config page (#302)
 * since snippet commands are the thing most commonly out of sync after a swap.
 */
export function ResyncCard() {
	const params = useParams<{ id: string }>();
	const { data: me } = useMe();
	const resyncModmail = useResyncModmail(params.id);
	const [resyncMessage, setResyncMessage] = useState<string | null>(null);
	const [resyncFailures, setResyncFailures] = useState<ResyncModmailResult['failures']>([]);

	const isCustomInstance = (me?.guilds.find((guild) => guild.id === params.id)?.customInstanceId ?? null) !== null;
	const canResync = isCustomInstance || (me?.isGlobalAdmin ?? false);

	if (!canResync) {
		return null;
	}

	const handleResync = async () => {
		setResyncMessage(null);
		setResyncFailures([]);
		const result = await resyncModmail.mutateAsync();
		setResyncMessage(
			`Done - ${result.snippetsRecreated} snippet command${result.snippetsRecreated === 1 ? '' : 's'} recreated, ` +
				`${result.staleCommandsDeleted} stale command${result.staleCommandsDeleted === 1 ? '' : 's'} removed, ` +
				`${result.panelsReposted} panel${result.panelsReposted === 1 ? '' : 's'} reposted.`,
		);
		setResyncFailures(result.failures);
	};

	return (
		<div className="space-y-3 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark md:col-span-2 lg:col-span-3">
			<div>
				<h3 className="text-sm font-medium text-primary dark:text-primary-dark">Resync</h3>
				<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
					Recreates any snippet command or panel message that belongs to an application that no longer owns this server
					- needed after moving this server onto or off of a custom ModMail instance. Safe to run any time; anything
					already correct is left alone.
				</p>
			</div>
			{resyncMessage && (
				<p className="text-sm text-misc-accent" role="status">
					{resyncMessage}
				</p>
			)}
			{resyncFailures.length > 0 && (
				<div
					className="flex items-start gap-2 rounded-md border border-misc-danger bg-misc-danger/10 p-2 text-sm text-misc-danger"
					role="alert"
				>
					<FaExclamationTriangle className="mt-0.5 h-4 w-4 shrink-0" />
					<div>
						<p>
							{resyncFailures.length} item{resyncFailures.length === 1 ? '' : 's'} failed and were skipped:
						</p>
						<ul className="mt-1 list-inside list-disc">
							{resyncFailures.map((failure, index) => (
								<li key={index}>
									{failure.item}: {failure.error}
								</li>
							))}
						</ul>
					</div>
				</div>
			)}
			<Button
				className="px-3 py-2.5 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
				onPress={handleResync}
				type="button"
			>
				Resync
			</Button>
		</div>
	);
}
