'use client';

import { appealsQueueChannel } from '@chatsift/core';
import { Button } from '@chatsift/web-core/components/Button';
import { Heading } from '@chatsift/web-core/components/Heading';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { useCopyToClipboard } from '@chatsift/web-core/hooks/useCopyToClipboard';
import { cn } from '@chatsift/web-core/utils/cn';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { statusLabel, STATUS_PILL_CLASSES } from '../../_components/appealDisplay';
import { AppealDecision } from './AppealDecision';
import { queryKeys } from '@/api/queryClient';
import type { AppealEvent } from '@/api/routes/appeals';
import { useAppeal } from '@/api/routes/appeals';
import { UserBadge } from '@/components/dashboard/UserBadge';
import { snapshotUserLabel } from '@/components/dashboard/userDisplay';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { formatDate } from '@/utils/util';

const EVENT_LABELS: Record<string, string> = {
	SUBMITTED: 'Appeal filed',
	APPROVED: 'Approved',
	DENIED: 'Denied',
	WITHDRAWN: 'Withdrawn by the appellant',
	// Says nothing about who lifted the ban: `GUILD_BAN_REMOVE` carries no actor, and naming one would need an
	// audit-log permission Appeals does not ask for (P4b).
	MOOT: 'Closed automatically, the ban was lifted elsewhere',
	NOTE: 'Note',
};

function Field({ label, children }: { readonly children: React.ReactNode; readonly label: string }) {
	return (
		<div className="flex flex-col gap-1">
			<p className="text-xs font-medium uppercase tracking-wide text-secondary dark:text-secondary-dark">{label}</p>
			<div className="text-sm text-primary dark:text-primary-dark">{children}</div>
		</div>
	);
}

/**
 * Prose typed by the appellant, or a ban reason typed by a moderator. Rendered flat rather than through
 * `DiscordMarkdown` on purpose: a reported *message* needs to read as Discord would show it, but an appeal
 * answer is a form field, and interpreting its markdown would let somebody dress their own text up as ours --
 * the same reasoning the card's `fence()` exists for.
 */
function Quoted({ children }: { readonly children: string }) {
	return (
		<p className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-on-tertiary p-3 text-sm dark:bg-on-tertiary-dark">
			{children}
		</p>
	);
}

function EventRow({ event }: { readonly event: AppealEvent }) {
	const who = event.actor ? snapshotUserLabel(event.actor, null) : null;

	return (
		<div className="flex flex-col gap-1 border-l-2 border-on-secondary pl-3 dark:border-on-secondary-dark">
			<p className="text-sm text-primary dark:text-primary-dark">
				{EVENT_LABELS[event.kind] ?? event.kind}
				{who ? ` by ${who}` : ''}
			</p>
			<p className="text-xs text-secondary dark:text-secondary-dark">{formatDate(new Date(event.createdAt))}</p>
			{event.body && <Quoted>{event.body}</Quoted>}
		</div>
	);
}

export function AppealDetail() {
	const { id: guildId, appealId: appealIdParam } = useParams<{ appealId: string; id: string }>();
	const appealId = Number(appealIdParam);
	const { copied: linkCopied, copy } = useCopyToClipboard();
	const queryClient = useQueryClient();

	// The same subscription the queue has: a decision taken on the card in Discord has to land here without a
	// refresh, because the two surfaces are meant to be interchangeable (decision 1).
	useRealtimeInvalidate(appealsQueueChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.appeals.queue.all(guildId) });
	});

	const { data, isLoading, error } = useAppeal(guildId, appealId);

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !data) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-10 w-64 rounded-lg" />
				<Skeleton className="h-64 w-full rounded-lg" />
			</div>
		);
	}

	const { appeal, answers, events } = data;
	const appellantId = appeal.userId;

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-3">
				<Heading
					title={`Appeal #${appeal.id}`}
					trailing={
						<span
							className={cn(
								'rounded-full px-2.5 py-1 text-xs font-medium',
								STATUS_PILL_CLASSES[appeal.status] ?? 'bg-on-tertiary text-secondary',
							)}
						>
							{statusLabel(appeal)}
						</span>
					}
				/>
				<UserBadge id={appellantId} size="lg" storedTag={null} user={appeal.appellant} />
			</div>

			{appeal.status === 'DENIED' && appeal.silent && (
				// The one thing on this page a moderator must not miss. A silent denial is invisible to the appellant
				// forever, so a second moderator reaching out to explain the decision is what blows it (decision 6).
				<p className="rounded-lg border border-misc-danger/40 bg-misc-danger/10 p-3 text-sm text-misc-danger">
					This was denied silently. Their appeal page still reads &quot;under review&quot;, and it always will. Do not
					contact them about this appeal.
				</p>
			)}

			<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<Field label="Ban reason when they appealed">
					{appeal.reasonSnapshot?.trim().length ? (
						<Quoted>{appeal.reasonSnapshot}</Quoted>
					) : (
						<p className="text-secondary dark:text-secondary-dark">Discord had no reason recorded for the ban.</p>
					)}
				</Field>

				<Field label="Filed">{formatDate(new Date(appeal.createdAt))}</Field>

				{appeal.decidedAt && (
					<Field label="Closed">
						{formatDate(new Date(appeal.decidedAt))}
						{appeal.decidedByUser ? ` by ${snapshotUserLabel(appeal.decidedByUser, null)}` : ''}
					</Field>
				)}

				{appeal.decisionReason && (
					<Field label={appeal.silent ? 'Note for the team' : 'Reason given to the appellant'}>
						<Quoted>{appeal.decisionReason}</Quoted>
					</Field>
				)}

				{appeal.modChannelId && appeal.modMessageId && (
					// Copied rather than linked, the call `ReportPromptCard` already made: a discord.com/channels link
					// opens the browser client, which is not where anyone managing a server is working.
					<div className="flex items-center gap-2">
						<Button
							className="h-fit p-0 text-sm text-misc-accent underline hover:bg-transparent"
							onPress={async () =>
								copy(`https://discord.com/channels/${guildId}/${appeal.modChannelId}/${appeal.modMessageId}`)
							}
						>
							Copy link to the card in Discord
						</Button>
						{linkCopied && <span className="text-sm text-misc-accent">Copied!</span>}
					</div>
				)}
			</div>

			<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<p className="text-sm font-medium text-primary dark:text-primary-dark">What they said</p>
				{answers.length === 0 ? (
					<p className="text-sm text-secondary dark:text-secondary-dark">This appeal has no answers on it.</p>
				) : (
					answers.map((answer) => (
						// The prompt as it read when they answered it, not the guild's current wording -- so editing the
						// questionnaire later never rewrites what somebody was asked (decision 7).
						<Field key={answer.id} label={answer.promptSnapshot}>
							{answer.answer.trim().length ? (
								<Quoted>{answer.answer}</Quoted>
							) : (
								<p className="text-secondary dark:text-secondary-dark">They left this blank.</p>
							)}
						</Field>
					))
				)}
			</div>

			{appeal.status === 'PENDING' && <AppealDecision appealId={appeal.id} guildId={guildId} />}

			<div className="flex flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<p className="text-sm font-medium text-primary dark:text-primary-dark">History</p>
				{events.map((event) => (
					<EventRow event={event} key={event.id} />
				))}
			</div>

			<Link
				className="text-sm text-misc-accent hover:underline"
				href={`/dashboard/${guildId}/appeals/queue?search=${appellantId}`}
			>
				See every appeal from this account
			</Link>
		</div>
	);
}
