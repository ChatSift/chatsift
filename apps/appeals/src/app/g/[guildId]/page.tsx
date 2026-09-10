'use client';

import { Heading } from '@chatsift/web-core/components/Heading';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { use } from 'react';
import { loginHref, useAppealsGuild, useMe } from '@/api/routes/appeals';
import { AppealForm } from '@/components/AppealForm';
import { AppealStatusBadge } from '@/components/AppealStatusBadge';
import { BlockedNotice } from '@/components/BlockedNotice';
import { GuildBadge } from '@/components/GuildBadge';

export default function GuildAppealPage({ params }: { readonly params: Promise<{ guildId: string }> }) {
	const { guildId } = use(params);
	const { data: user, isPending: isUserPending } = useMe();

	const { data, isPending, error } = useAppealsGuild(guildId, Boolean(user));

	if (isUserPending) {
		return <Skeleton className="h-40 w-full" />;
	}

	if (!user) {
		return (
			<>
				<Heading
					subtitle="Sign in with the Discord account that was banned. We use it to confirm the ban and to send you the decision."
					title="Appeal a ban"
				/>
				<a className={buttonClass('primary')} href={loginHref(`/g/${guildId}`)}>
					Sign in with Discord
				</a>
			</>
		);
	}

	if (isPending) {
		return <Skeleton className="h-40 w-full" />;
	}

	if (error || !data) {
		return (
			<Heading
				subtitle="We could not load this server right now. Try again in a few minutes."
				title="Something went wrong"
			/>
		);
	}

	const appealsRemaining = data.maxAppeals === null ? null : Math.max(0, data.maxAppeals - data.appealsUsed);

	return (
		<>
			<GuildBadge guild={data.guild} unknownLabel="This server" />

			{data.latestAppeal && (
				<div className="flex flex-col gap-3 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-lg font-medium text-primary dark:text-primary-dark">Your appeal</p>
						<AppealStatusBadge status={data.latestAppeal.status} />
					</div>
					<p className="text-sm text-secondary dark:text-secondary-dark">
						Submitted {new Date(data.latestAppeal.createdAt).toLocaleDateString(undefined, { dateStyle: 'long' })}
					</p>
					{data.latestAppeal.answers.map((answer) => (
						<div key={answer.position}>
							<p className="text-sm font-medium text-secondary dark:text-secondary-dark">{answer.promptSnapshot}</p>
							<p className="whitespace-pre-wrap text-primary dark:text-primary-dark">
								{answer.answer || <span className="text-disabled dark:text-disabled-dark">No answer</span>}
							</p>
						</div>
					))}
				</div>
			)}

			{data.blocked ? (
				<BlockedNotice cooldownUntil={data.cooldownUntil} reason={data.blocked} />
			) : (
				<AppealForm appealsRemaining={appealsRemaining} guildId={guildId} questions={data.questions} />
			)}
		</>
	);
}
