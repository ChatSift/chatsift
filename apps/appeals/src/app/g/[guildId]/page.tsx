'use client';

import { Heading } from '@chatsift/web-core/components/Heading';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { use } from 'react';
import { useAppealsGuild, useMe } from '@/api/routes/appeals';
import { AppealForm } from '@/components/AppealForm';
import { AppealStatusBadge } from '@/components/AppealStatusBadge';
import { BlockedNotice } from '@/components/BlockedNotice';
import { DeliveryNotice } from '@/components/DeliveryNotice';
import { GuildBadge } from '@/components/GuildBadge';
import { RejoinGrantPrompt } from '@/components/RejoinGrantPrompt';
import { SignInPrompt } from '@/components/SignInPrompt';

export default function GuildAppealPage({ params }: { readonly params: Promise<{ guildId: string }> }) {
	const { guildId } = use(params);
	const { data: user, isPending: isUserPending } = useMe();

	const { data, isPending, error } = useAppealsGuild(guildId, Boolean(user));

	if (isUserPending) {
		return <Skeleton className="h-40 w-full" />;
	}

	if (!user) {
		return (
			<SignInPrompt
				redirectTo={`/g/${guildId}`}
				subtitle="Sign in with the Discord account that was banned, so the server knows the appeal is really from you."
				title="Appeal a Discord ban"
			/>
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

	// Only while it is open, and only when they actually asked for it. `status` here is the public one, so a
	// silent denial still counts as open -- which is right: their page reads "under review", and every
	// affordance on it has to keep reading that way (decision 6).
	const needsRejoinGrant =
		data.latestAppeal?.status === 'PENDING' && data.latestAppeal.rejoinConsent && !user.canRejoin;

	return (
		<>
			<GuildBadge guild={data.guild} unknownLabel="This server" />

			{/* Above everything, and regardless of whether they can file right now: it is as relevant to an appeal
			    already under review as it is to one they are about to write. */}
			{user.dmReachable === false && <DeliveryNotice />}

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

			{needsRejoinGrant && <RejoinGrantPrompt guildId={guildId} />}

			{data.blocked ? (
				<BlockedNotice cooldownUntil={data.cooldownUntil} reason={data.blocked} />
			) : (
				<AppealForm
					appealsRemaining={appealsRemaining}
					canRejoin={user.canRejoin}
					guildId={guildId}
					questions={data.questions}
				/>
			)}
		</>
	);
}
