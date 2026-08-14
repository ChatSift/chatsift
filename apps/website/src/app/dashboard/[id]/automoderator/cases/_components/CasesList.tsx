'use client';

import { automoderatorCasesChannel } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useActionFilter, useIncludePardonedFilter } from './CaseFilters';
import { ACTION_LABELS, ACTION_PILL_CLASSES, caseUserLabel } from './caseDisplay';
import { queryKeys } from '@/api/queryClient';
import type { AutomoderatorCaseListItem } from '@/api/routes/automoderatorCases';
import { useAutomoderatorCases } from '@/api/routes/automoderatorCases';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { cn, formatDate } from '@/utils/util';

function CaseRow({ guildId, modCase }: { readonly guildId: string; readonly modCase: AutomoderatorCaseListItem }) {
	return (
		<Link
			className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark sm:flex-row sm:items-center sm:justify-between"
			href={`/dashboard/${guildId}/automoderator/cases/${modCase.caseId}`}
		>
			<div className="flex flex-col overflow-hidden">
				<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-medium text-primary dark:text-primary-dark">
					<span className="text-secondary dark:text-secondary-dark">#{modCase.caseId}</span>{' '}
					{caseUserLabel(modCase.target, modCase.targetTag)}
				</p>
				<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-sm text-secondary dark:text-secondary-dark">
					{modCase.reason ?? 'No reason given'} · {formatDate(new Date(modCase.createdAt))}
					{modCase.modTag ? ` · by ${modCase.modTag}` : ''}
				</p>
			</div>

			<div className="flex shrink-0 items-center gap-2">
				{modCase.dryRun && (
					<span className="rounded-full bg-on-tertiary px-2.5 py-1 text-xs font-medium text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark">
						Dry run
					</span>
				)}
				{modCase.pardonedBy && (
					<span className="rounded-full bg-on-tertiary px-2.5 py-1 text-xs font-medium text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark">
						Pardoned
					</span>
				)}
				<span
					className={cn(
						'rounded-full px-2.5 py-1 text-xs font-medium',
						ACTION_PILL_CLASSES[modCase.actionType] ?? 'bg-on-tertiary text-secondary',
					)}
				>
					{ACTION_LABELS[modCase.actionType] ?? modCase.actionType}
				</span>
			</div>
		</Link>
	);
}

export function CasesList() {
	const { id: guildId } = useParams<{ id: string }>();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorCasesChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.cases.all(guildId) });
	});

	// The list's search box filters by a target's raw id rather than free text: cases store a username
	// snapshot, not a searchable one, and Discord's member search can't find someone who has since left --
	// which is exactly who a ban case is about.
	// Empty-or-whitespace has to collapse to `undefined`, not `''`: an empty `target_id=` fails the API's
	// snowflake schema outright, and it would key a separate cache entry from "no filter". `??` won't do it --
	// `''` isn't nullish.
	const search = searchParams.get('search')?.trim();
	const targetId = search?.length ? search : undefined;
	const action = useActionFilter();
	const includePardoned = useIncludePardonedFilter();

	const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useAutomoderatorCases(guildId, {
		action,
		includePardoned,
		targetId,
	});

	const cases = data?.pages.flatMap((page) => page.cases) ?? [];

	if (error && cases.length === 0) {
		return <UserErrorHandler error={error} />;
	}

	return (
		<div className="flex flex-col gap-4">
			{isLoading ? (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-20 w-full rounded-lg" />
					<Skeleton className="h-20 w-full rounded-lg" />
					<Skeleton className="h-20 w-full rounded-lg" />
				</div>
			) : cases.length === 0 ? (
				<EmptyState
					icon={<SvgAutoModerator height={28} width={28} />}
					subtitle={
						targetId || action
							? 'No cases match these filters.'
							: 'Moderation actions taken through commands, or through Discord itself, will show up here.'
					}
					title="No cases yet"
				/>
			) : (
				<div className="flex flex-col gap-3">
					{cases.map((modCase) => (
						<CaseRow guildId={guildId} key={modCase.id} modCase={modCase} />
					))}
				</div>
			)}

			{hasNextPage && (
				<Button
					className="w-fit border border-on-secondary dark:border-on-secondary-dark"
					isDisabled={isFetchingNextPage}
					onPress={() => fetchNextPage()}
				>
					{isFetchingNextPage ? 'Loading...' : 'Load more'}
				</Button>
			)}
		</div>
	);
}
