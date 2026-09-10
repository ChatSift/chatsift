'use client';

import { EmptyState } from '@chatsift/web-core/components/EmptyState';
import { Heading } from '@chatsift/web-core/components/Heading';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import Link from 'next/link';
import { HiOutlineInbox } from 'react-icons/hi2';
import { loginHref, useMe, useMyAppeals } from '@/api/routes/appeals';
import { AppealStatusBadge } from '@/components/AppealStatusBadge';
import { GuildBadge } from '@/components/GuildBadge';

export default function MyAppealsPage() {
	const { data: user, isPending: isUserPending } = useMe();
	const { data, isPending } = useMyAppeals(Boolean(user));

	if (isUserPending) {
		return <Skeleton className="h-40 w-full" />;
	}

	if (!user) {
		return (
			<>
				<Heading subtitle="Sign in to see the appeals you have filed." title="Your appeals" />
				<a className={buttonClass('primary')} href={loginHref('/appeals')}>
					Sign in with Discord
				</a>
			</>
		);
	}

	if (isPending || !data) {
		return <Skeleton className="h-40 w-full" />;
	}

	return (
		<>
			<Heading subtitle="Every appeal you have filed, and where it stands." title="Your appeals" />

			{data.appeals.length === 0 ? (
				<EmptyState
					icon={<HiOutlineInbox className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
					subtitle="Paste an invite to the server you were banned from to get started."
					title="You have not filed any appeals"
				/>
			) : (
				<div className="flex flex-col gap-3">
					{data.appeals.map((appeal) => (
						<Link
							className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-on-secondary bg-card p-4 transition-colors hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
							href={`/g/${appeal.guildId}`}
							key={appeal.id}
						>
							<GuildBadge guild={appeal.guild} />
							<div className="flex items-center gap-3">
								<span className="text-sm text-secondary dark:text-secondary-dark">
									{new Date(appeal.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
								</span>
								<AppealStatusBadge status={appeal.status} />
							</div>
						</Link>
					))}
				</div>
			)}

			{data.recentlyChecked.length > 0 && (
				<div className="flex flex-col gap-3">
					<Heading
						subtitle="Servers you already checked here and were banned in, with no appeal filed yet. We re-check when you open one."
						title="Picked up where you left off"
					/>
					{data.recentlyChecked.map((guild) => (
						<Link
							className="flex items-center justify-between gap-3 rounded-lg border border-on-secondary bg-card p-4 transition-colors hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
							href={`/g/${guild.id}`}
							key={guild.id}
						>
							<GuildBadge guild={guild} />
							<span className="text-sm text-misc-accent">Appeal</span>
						</Link>
					))}
				</div>
			)}
		</>
	);
}
