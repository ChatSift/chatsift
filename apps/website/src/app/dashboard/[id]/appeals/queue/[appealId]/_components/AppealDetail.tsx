'use client';

import { appealsQueueChannel } from '@chatsift/core';
import { Button } from '@chatsift/web-core/components/Button';
import { DiscordUserAvatar } from '@chatsift/web-core/components/DiscordUserAvatar';
import { Heading } from '@chatsift/web-core/components/Heading';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { useCopyToClipboard } from '@chatsift/web-core/hooks/useCopyToClipboard';
import { cn } from '@chatsift/web-core/utils/cn';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FaRobot } from 'react-icons/fa';
import { statusLabel, STATUS_PILL_CLASSES } from '../../_components/appealDisplay';
import { AppealDecision } from './AppealDecision';
import { queryKeys } from '@/api/queryClient';
import type { AppealEvent, GetAppealResult } from '@/api/routes/appeals';
import { useAppeal, useAppeals } from '@/api/routes/appeals';
import { UserBadge } from '@/components/dashboard/UserBadge';
import { snapshotUserLabel } from '@/components/dashboard/userDisplay';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { formatDate } from '@/utils/util';

/**
 * Written to follow the actor's name, so a row reads as one sentence ("DD filed this appeal") rather than as a
 * name with a caption under it.
 */
const EVENT_VERBS: Record<string, string> = {
	SUBMITTED: 'filed this appeal',
	APPROVED: 'approved it',
	DENIED: 'denied it',
	WITHDRAWN: 'withdrew it',
	// Says nothing about who lifted the ban: `GUILD_BAN_REMOVE` carries no actor, and naming one would need an
	// audit-log permission Appeals does not ask for (P4b).
	MOOT: 'closed it, the ban had been lifted elsewhere',
	NOTE: 'left a note',
};

/**
 * `DELIVERY` (#232 P6) is the one kind whose sentence depends on what happened rather than on the kind alone --
 * a DM that landed, one Discord refused, an approval that put somebody back in the server. The API writes that
 * sentence into the event's body, so here it reads as the verb rather than as a quote underneath one.
 */
function eventSentence(event: AppealEvent): { quote: string | null; verb: string } {
	if (event.kind === 'DELIVERY') {
		return { verb: event.body ?? 'delivered the decision', quote: null };
	}

	return { verb: EVENT_VERBS[event.kind] ?? event.kind, quote: event.body };
}

function Field({ label, children }: { readonly children: React.ReactNode; readonly label: string }) {
	return (
		<div className="flex flex-col gap-1">
			<p className="text-xs font-medium uppercase tracking-wide text-secondary dark:text-secondary-dark">{label}</p>
			<div className="text-sm text-primary dark:text-primary-dark">{children}</div>
		</div>
	);
}

function Card({ children }: { readonly children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			{children}
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

/**
 * One entry in the trail: avatar, then "who did what" as a single sentence, then when. An account is never a
 * bare name anywhere on this page -- it either has its avatar beside it here, or it is a full `UserBadge` in
 * the sidebar.
 */
function EventRow({ event }: { readonly event: AppealEvent }) {
	// `MOOT` and `DELIVERY` are the events nobody takes: the bot noticing the ban was gone, and the decision
	// being handed to the appellant. Rendered as the bot rather than as an anonymous blank, so the trail never
	// reads as "somebody we could not identify did this".
	const isSystem = event.actor === null;
	const label = event.actor ? snapshotUserLabel(event.actor, null) : 'Appeals';
	const { verb, quote } = eventSentence(event);

	return (
		<div className="flex gap-3">
			{isSystem ? (
				<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-misc-system/10 text-misc-system dark:bg-misc-system-dark/10 dark:text-misc-system-dark">
					<FaRobot className="h-4 w-4" />
				</div>
			) : (
				<DiscordUserAvatar className="h-8 w-8 shrink-0 rounded-full" initials={label.slice(0, 2)} user={event.actor!} />
			)}

			<div className="flex min-w-0 flex-col gap-1">
				<p className="text-sm text-secondary dark:text-secondary-dark">
					<span className="font-medium text-primary dark:text-primary-dark">{label}</span> {verb}
				</p>
				<p className="text-xs text-secondary dark:text-secondary-dark">{formatDate(new Date(event.createdAt))}</p>
				{quote && <Quoted>{quote}</Quoted>}
			</div>
		</div>
	);
}

/**
 * The rest of this account's history with the server, the way `OtherCases` does it on a case. An appellant who
 * has filed before is the single most useful thing on this page for deciding, and it is one query the queue is
 * already caching.
 */
function OtherAppeals({ appeal, guildId }: { readonly appeal: GetAppealResult['appeal']; readonly guildId: string }) {
	const { data } = useAppeals(guildId, { userId: appeal.userId });
	const others = (data?.pages.flatMap((page) => page.appeals) ?? []).filter((other) => other.id !== appeal.id);

	if (others.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="text-sm font-medium text-primary dark:text-primary-dark">Their other appeals here</p>
			<div className="flex flex-col gap-1">
				{others.slice(0, 10).map((other) => (
					<Link
						className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark"
						href={`/dashboard/${guildId}/appeals/queue/${other.id}`}
						key={other.id}
					>
						<span className="text-secondary dark:text-secondary-dark">#{other.id}</span>
						<span
							className={cn(
								'rounded-full px-2 py-0.5 text-xs font-medium',
								STATUS_PILL_CLASSES[other.status] ?? 'bg-on-tertiary text-secondary',
							)}
						>
							{statusLabel(other)}
						</span>
					</Link>
				))}
			</div>
		</div>
	);
}

export function AppealDetail() {
	const { id: guildId, appealId: appealIdParam } = useParams<{ appealId: string; id: string }>();
	const appealId = Number(appealIdParam);
	const { copied: linkCopied, copy } = useCopyToClipboard();
	const queryClient = useQueryClient();

	// The same subscription the queue has: a decision taken in Discord has to land here without a refresh,
	// because the two surfaces are meant to be interchangeable (decision 1).
	useRealtimeInvalidate(appealsQueueChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.appeals.queue.all(guildId) });
	});

	const { data, isLoading, error } = useAppeal(guildId, appealId);

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !data) {
		return (
			<div className="flex flex-col gap-6 lg:flex-row">
				<div className="flex flex-1 flex-col gap-4">
					<Skeleton className="h-10 w-64 rounded-lg" />
					<Skeleton className="h-64 w-full rounded-lg" />
				</div>
				<Skeleton className="h-64 w-full rounded-lg lg:w-80 lg:shrink-0" />
			</div>
		);
	}

	const { appeal, answers, events } = data;
	const isSilentDenial = appeal.status === 'DENIED' && appeal.silent;

	return (
		<div className="flex flex-col gap-6 lg:flex-row">
			<div className="flex min-w-0 flex-1 flex-col gap-6">
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
					<UserBadge id={appeal.userId} size="lg" storedTag={null} user={appeal.appellant} />
				</div>

				{isSilentDenial && (
					// The one thing on this page a moderator must not miss. A silent denial is invisible to the
					// appellant forever, so a second moderator reaching out to explain it is what blows it (decision 6).
					<p className="rounded-lg border border-misc-danger/40 bg-misc-danger/10 p-3 text-sm text-misc-danger">
						This was denied silently. Their appeal page still reads &quot;under review&quot;, and it always will. Do not
						contact them about this appeal.
					</p>
				)}

				<Card>
					<Field label="Why they were banned">
						{appeal.reasonSnapshot?.trim().length ? (
							<Quoted>{appeal.reasonSnapshot}</Quoted>
						) : (
							<p className="text-secondary dark:text-secondary-dark">Discord had no reason recorded for the ban.</p>
						)}
					</Field>
				</Card>

				<Card>
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
				</Card>

				{appeal.status === 'PENDING' ? (
					<AppealDecision appealId={appeal.id} guildId={guildId} />
				) : (
					appeal.decisionReason && (
						<Card>
							<Field label={isSilentDenial ? 'Note for your team' : 'Reason given to the appellant'}>
								<Quoted>{appeal.decisionReason}</Quoted>
							</Field>
						</Card>
					)
				)}

				<Card>
					<p className="text-sm font-medium text-primary dark:text-primary-dark">History</p>
					<div className="flex flex-col gap-4">
						{events.map((event) => (
							<EventRow event={event} key={event.id} />
						))}
					</div>
				</Card>
			</div>

			<div className="flex flex-col gap-4 lg:w-80 lg:shrink-0">
				<Card>
					<Field label="Filed">{formatDate(new Date(appeal.createdAt))}</Field>

					{/* What Approve will actually do, stated before it is pressed (#232 P6). Only the yes is worth a
					    row: an appellant who did not tick the box is the ordinary case, and a sidebar line on every
					    appeal saying nothing will happen is a line nobody reads. It says "asked to be" rather than
					    "will be" because the guild's own Appeals setting is the other half of it. */}
					{appeal.rejoinConsent && (
						<Field label="Rejoining">
							<span className="text-secondary dark:text-secondary-dark">
								They asked to be added back automatically if this is approved.
							</span>
						</Field>
					)}

					{appeal.decidedAt && <Field label="Closed">{formatDate(new Date(appeal.decidedAt))}</Field>}

					{appeal.decidedAt &&
						(appeal.decidedById ? (
							<Field label="Decided by">
								<UserBadge id={appeal.decidedById} storedTag={null} user={appeal.decidedByUser} />
							</Field>
						) : (
							// A withdrawal and a `MOOT` close both carry a null actor by construction, and they are not the
							// same non-answer -- saying which is what stops this reading as attribution we lost.
							<Field label="Decided by">
								<span className="text-secondary dark:text-secondary-dark">
									{appeal.status === 'WITHDRAWN' ? 'Nobody, they withdrew it' : 'Nobody, the ban was lifted elsewhere'}
								</span>
							</Field>
						))}

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
								Copy Discord message link
							</Button>
							{linkCopied && <span className="text-sm text-misc-accent">Copied!</span>}
						</div>
					)}
				</Card>

				<OtherAppeals appeal={appeal} guildId={guildId} />
			</div>
		</div>
	);
}
