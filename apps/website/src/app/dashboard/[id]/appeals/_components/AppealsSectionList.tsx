'use client';

import { appealsConfigChannel } from '@chatsift/core';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { queryKeys } from '@/api/queryClient';
import { useAppealsConfig } from '@/api/routes/appeals';
import { SvgAppeals } from '@/components/icons/SvgAppeals';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { APPEALS_SECTION_LIST } from '@/utils/appealsSections';

/**
 * Client-side, unlike every other bot's hub, because an unconfigured guild gets a setup CTA instead of the
 * section list -- and that state is only knowable from `appeals_settings` (`settings === null`). Listing
 * "Unappealable Users" for a server that accepts no appeals at all would be offering to configure an exception
 * to a rule that isn't running yet.
 */
export function AppealsSectionList() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	// Subscribed here too, not just on the config page: this is the screen whose *whole* content the settings
	// row decides, so a setup finished elsewhere has to drop the CTA rather than leave it advertising work
	// somebody already did.
	useRealtimeInvalidate(appealsConfigChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.appeals.config(guildId) });
	});

	const { data: config, isLoading, error } = useAppealsConfig(guildId);

	// Same reasoning as `BlocksList`/`GrantsList`: a background refetch failure leaves the previous response
	// cached, and stale-but-present data should keep rendering rather than being replaced by the error state.
	if (error && config === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !config) {
		return (
			<>
				<Skeleton className="h-20 w-full rounded-lg" />
				<Skeleton className="h-20 w-full rounded-lg" />
			</>
		);
	}

	if (!config.settings) {
		return (
			<div className="flex w-full flex-col items-center gap-3 rounded-lg border border-dashed border-on-secondary bg-card p-8 text-center dark:border-on-secondary-dark dark:bg-card-dark">
				<SvgAppeals height={32} width={32} />
				<p className="text-lg font-medium text-primary dark:text-primary-dark">Appeals isn&apos;t set up yet</p>
				<Link
					className="text-sm font-medium text-misc-accent underline"
					href={`/dashboard/${guildId}/appeals/config`}
					prefetch
				>
					Set up Appeals
				</Link>
			</div>
		);
	}

	return (
		<>
			{APPEALS_SECTION_LIST.map(({ segment, title, subtitle }) => (
				<Link
					className="flex items-center gap-4 rounded-lg border-[1px] border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
					href={`/dashboard/${guildId}/appeals/${segment}`}
					key={segment}
					prefetch
				>
					<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-on-tertiary dark:bg-on-tertiary-dark">
						<SvgAppeals height={28} width={28} />
					</div>
					<div className="flex flex-col">
						<p className="text-lg font-medium text-primary dark:text-primary-dark">{title}</p>
						<p className="text-sm text-secondary dark:text-secondary-dark">{subtitle}</p>
					</div>
				</Link>
			))}
		</>
	);
}
