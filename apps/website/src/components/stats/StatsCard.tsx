'use client';

import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import type { ReactNode } from 'react';

interface StatsCardProps {
	readonly children: ReactNode;
	readonly isError: boolean;
	readonly isLoading: boolean;
	readonly title?: string;
}

/**
 * The shell every bot's analytics card shares (#403): the card chrome, the heading, and the two states that
 * are not "here are the numbers". Failing to a single line rather than an error banner is deliberate -- this
 * card sits above a hub page whose actual job is navigation, and a stats query that 500s should not make the
 * links underneath it look broken.
 */
export function StatsCard({ children, isError, isLoading, title = 'Analytics' }: StatsCardProps) {
	return (
		<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
			<h2 className="mb-4 text-xl font-medium text-primary dark:text-primary-dark">{title}</h2>
			{isLoading ? (
				<Skeleton className="h-24 w-full" />
			) : isError ? (
				<p className="text-sm text-secondary dark:text-secondary-dark">Unable to load analytics right now.</p>
			) : (
				children
			)}
		</div>
	);
}
