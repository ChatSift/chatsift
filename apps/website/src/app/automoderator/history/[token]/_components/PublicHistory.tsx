'use client';

import { useParams } from 'next/navigation';
import { useAutomoderatorPublicHistory } from '@/api/routes/automoderatorCases';
import { EmptyState } from '@/components/common/EmptyState';
import { Heading } from '@/components/common/Heading';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { cn, formatDate } from '@/utils/util';

const ACTION_LABELS: Record<string, string> = {
	WARN: 'Warning',
	MUTE: 'Timeout',
	UNMUTE: 'Timeout lifted',
	KICK: 'Kick',
	SOFTBAN: 'Softban',
	BAN: 'Ban',
	UNBAN: 'Ban lifted',
};

const ACTION_PILL_CLASSES: Record<string, string> = {
	BAN: 'bg-misc-danger/10 text-misc-danger',
	SOFTBAN: 'bg-misc-danger/10 text-misc-danger',
	KICK: 'bg-misc-warning/10 text-misc-warning dark:bg-misc-warning-dark/10 dark:text-misc-warning-dark',
	MUTE: 'bg-misc-warning/10 text-misc-warning dark:bg-misc-warning-dark/10 dark:text-misc-warning-dark',
	WARN: 'bg-misc-system/10 text-misc-system dark:bg-misc-system-dark/10 dark:text-misc-system-dark',
	UNMUTE: 'bg-misc-accent/10 text-misc-accent',
	UNBAN: 'bg-misc-accent/10 text-misc-accent',
};

export function PublicHistory() {
	const { token } = useParams<{ token: string }>();
	const { data, isLoading, error } = useAutomoderatorPublicHistory(token);

	if (isLoading) {
		return (
			<div className="flex flex-col gap-3">
				<Skeleton className="h-16 w-full rounded-lg" />
				<Skeleton className="h-16 w-full rounded-lg" />
			</div>
		);
	}

	if (error || !data) {
		return (
			<EmptyState
				icon={<SvgAutoModerator height={28} width={28} />}
				subtitle="This link has expired. Run /myhistory again in the server to get a fresh one."
				title="Link expired"
			/>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<Heading
				subtitle={data.guildName ? `Your moderation history in ${data.guildName}` : 'Your moderation history'}
				title="Your history"
			/>

			{data.cases.length === 0 ? (
				<EmptyState
					icon={<SvgAutoModerator height={28} width={28} />}
					subtitle="You have no moderation history in this server."
					title="Nothing here"
				/>
			) : (
				<div className="flex flex-col gap-3">
					{data.cases.map((entry) => (
						<div
							className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark sm:flex-row sm:items-center sm:justify-between"
							key={entry.caseId}
						>
							<div className="flex flex-col overflow-hidden">
								<p className="text-primary dark:text-primary-dark">{entry.reason ?? 'No reason given'}</p>
								<p className="text-sm text-secondary dark:text-secondary-dark">
									{formatDate(new Date(entry.createdAt))}
									{entry.expiresAt ? ` · until ${formatDate(new Date(entry.expiresAt))}` : ''}
								</p>
							</div>

							<span
								className={cn(
									'w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
									ACTION_PILL_CLASSES[entry.action] ?? 'bg-on-tertiary text-secondary',
								)}
							>
								{ACTION_LABELS[entry.action] ?? entry.action}
							</span>
						</div>
					))}
				</div>
			)}

			<p className="text-sm text-secondary dark:text-secondary-dark">
				This link expires a few minutes after you ran the command. Pardoned warnings are not shown.
			</p>
		</div>
	);
}
