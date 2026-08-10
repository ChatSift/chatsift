'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FaExclamationTriangle } from 'react-icons/fa';
import { useMe } from '@/api/routes/auth';
import type { ResyncFailure } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';

export interface ResyncOutcome {
	failures: ResyncFailure[];
	/**
	 * Human-readable one-liner shown after a run -- built by the caller, since what's worth counting differs
	 * per surface (commands recreated/removed vs. panels reposted).
	 */
	summary: string;
}

interface ResyncCardProps {
	readonly description: string;
	resync(): Promise<ResyncOutcome>;
}

/**
 * Shared chrome for the two resync cards (#331 split the single #216 P6 endpoint into a snippets one and a
 * panels one, each surfaced on its own dashboard page). Resync is only ever needed around a custom-instance
 * swap, so it stays hidden for a normal guild -- a global admin can still reach it anywhere, since they're the
 * one who'd actually perform a swap and may need to run it for a guild they don't otherwise manage day-to-day.
 */
export function ResyncCard({ description, resync }: ResyncCardProps) {
	const params = useParams<{ id: string }>();
	const { data: me } = useMe();
	const [message, setMessage] = useState<string | null>(null);
	const [failures, setFailures] = useState<ResyncFailure[]>([]);

	const isCustomInstance = (me?.guilds.find((guild) => guild.id === params.id)?.customInstanceId ?? null) !== null;
	const canResync = isCustomInstance || (me?.isGlobalAdmin ?? false);

	if (!canResync) {
		return null;
	}

	const handleResync = async () => {
		setMessage(null);
		setFailures([]);
		const outcome = await resync();
		setMessage(outcome.summary);
		setFailures(outcome.failures);
	};

	return (
		<div className="space-y-3 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark md:col-span-2 lg:col-span-3">
			<div>
				<h3 className="text-sm font-medium text-primary dark:text-primary-dark">Resync</h3>
				<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">{description}</p>
			</div>
			{message && (
				<p className="text-sm text-misc-accent" role="status">
					{message}
				</p>
			)}
			{failures.length > 0 && (
				<div
					className="flex items-start gap-2 rounded-md border border-misc-danger bg-misc-danger/10 p-2 text-sm text-misc-danger"
					role="alert"
				>
					<FaExclamationTriangle className="mt-0.5 h-4 w-4 shrink-0" />
					<div>
						<p>
							{failures.length} item{failures.length === 1 ? '' : 's'} failed and were skipped:
						</p>
						<ul className="mt-1 list-inside list-disc">
							{failures.map((failure, index) => (
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
