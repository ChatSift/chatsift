'use client';

import { automoderatorReportsChannel } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { snapshotUserLabel } from '../../_components/userDisplay';
import { useStateFilter } from './ReportFilters';
import { reporterCountLabel, STATE_LABELS, STATE_PILL_CLASSES } from './reportDisplay';
import { queryKeys } from '@/api/queryClient';
import type { AutomoderatorReportListItem } from '@/api/routes/automoderatorReports';
import { useAutomoderatorReports } from '@/api/routes/automoderatorReports';
import { Button } from '@/components/common/Button';
import { DiscordUserAvatar } from '@/components/common/DiscordUserAvatar';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { cn, formatDate } from '@/utils/util';

function previewLine(report: AutomoderatorReportListItem): string {
	if (!report.messageId) {
		return 'Reported for their behavior, not a specific message';
	}

	const content = report.messageContent?.trim();
	if (content?.length) {
		return content;
	}

	return report.messageImageUrl ? 'An image with no text' : 'A message with no text content';
}

function ReportRow({ guildId, report }: { readonly guildId: string; readonly report: AutomoderatorReportListItem }) {
	return (
		<Link
			className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark sm:flex-row sm:items-center sm:justify-between"
			href={`/dashboard/${guildId}/automoderator/reports/${report.id}`}
		>
			<div className="flex min-w-0 items-center gap-3">
				<DiscordUserAvatar
					className="h-10 w-10 shrink-0 rounded-full"
					initials={snapshotUserLabel(report.target, report.targetTag).slice(0, 2)}
					user={report.target}
				/>
				<div className="flex min-w-0 flex-col overflow-hidden">
					<p className="truncate text-lg font-medium text-primary dark:text-primary-dark">
						{snapshotUserLabel(report.target, report.targetTag)}
					</p>
					<p className="truncate text-sm text-secondary dark:text-secondary-dark">{previewLine(report)}</p>
					<p className="text-sm text-secondary dark:text-secondary-dark">
						{reporterCountLabel(report.reporterCount)} · {formatDate(new Date(report.createdAt))}
						{report.caseId ? ` · case #${report.caseId}` : ''}
					</p>
				</div>
			</div>

			<div className="flex shrink-0 items-center gap-2">
				<span
					className={cn(
						'rounded-full px-2.5 py-1 text-xs font-medium',
						STATE_PILL_CLASSES[report.state] ?? 'bg-on-tertiary text-secondary',
					)}
				>
					{STATE_LABELS[report.state] ?? report.state}
				</span>
			</div>
		</Link>
	);
}

export function ReportsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();

	// Reports originate in Discord, so this subscription is the only thing that keeps an open queue current --
	// the bot publishes here when one is filed, joined, dismissed or actioned.
	useRealtimeInvalidate(automoderatorReportsChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.reports.all(guildId) });
	});

	// Raw id rather than free text, for the reason `CasesList` documents: a report stores a username snapshot,
	// and the account it is about has often left.
	// Empty-or-whitespace must collapse to `undefined` rather than `''` -- an empty `target_id=` fails the API's
	// snowflake schema and would key a separate cache entry from "no filter".
	const search = searchParams.get('search')?.trim();
	const targetId = search?.length ? search : undefined;
	const state = useStateFilter();

	const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useAutomoderatorReports(guildId, {
		state,
		targetId,
	});

	const reports = data?.pages.flatMap((page) => page.reports) ?? [];

	if (error && reports.length === 0) {
		return <UserErrorHandler error={error} />;
	}

	return (
		<div className="flex flex-col gap-4">
			{isLoading ? (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-24 w-full rounded-lg" />
					<Skeleton className="h-24 w-full rounded-lg" />
					<Skeleton className="h-24 w-full rounded-lg" />
				</div>
			) : reports.length === 0 ? (
				<EmptyState
					icon={<SvgAutoModerator height={28} width={28} />}
					subtitle={
						targetId || state
							? 'No reports match these filters.'
							: 'Members reporting messages with the Report Message context menu will show up here. Reporting is off until a reports channel is set.'
					}
					title="No reports yet"
				/>
			) : (
				<div className="flex flex-col gap-3">
					{reports.map((report) => (
						<ReportRow guildId={guildId} key={report.id} report={report} />
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
