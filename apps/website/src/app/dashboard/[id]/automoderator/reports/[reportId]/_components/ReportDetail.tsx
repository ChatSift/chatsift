'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { snapshotUserLabel } from '../../../_components/userDisplay';
import { reporterCountLabel, STATE_LABELS, STATE_PILL_CLASSES } from '../../_components/reportDisplay';
import { useAutomoderatorReport } from '@/api/routes/automoderatorReports';
import { Button } from '@/components/common/Button';
import { DiscordUserAvatar } from '@/components/common/DiscordUserAvatar';
import { Heading } from '@/components/common/Heading';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { cn, formatDate } from '@/utils/util';

// `ssr: false` is load-bearing -- see `DiscordMarkdown.tsx`'s own doc comment on why its wasm parser can't
// be evaluated server-side at all under Next's bundler.
const DiscordMarkdown = dynamic(
	async () => {
		const mod = await import('@/components/common/DiscordMarkdown');
		return mod.DiscordMarkdown;
	},
	{
		loading: () => <Skeleton className="h-4 w-48" />,
		ssr: false,
	},
);

function Field({ label, children }: { readonly children: React.ReactNode; readonly label: string }) {
	return (
		<div className="flex flex-col gap-1">
			<p className="text-xs font-medium uppercase tracking-wide text-secondary dark:text-secondary-dark">{label}</p>
			<div className="text-sm text-primary dark:text-primary-dark">{children}</div>
		</div>
	);
}

/**
 * Read-only, deliberately: a report is handled from the card in the reports channel, because handling it means
 * warning or banning somebody and that path already exists there with the hierarchy and permission checks the
 * bot enforces. Duplicating it here would mean duplicating those checks, which is how the two drift.
 */
export function ReportDetail() {
	const { id: guildId, reportId: reportIdParam } = useParams<{ id: string; reportId: string }>();
	const reportId = Number(reportIdParam);
	const [linkCopied, setLinkCopied] = useState(false);

	const { data, isLoading, error } = useAutomoderatorReport(guildId, reportId);

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

	const { report, reporters } = data;

	return (
		<div className="flex flex-col gap-6">
			<Heading
				subtitle={`${snapshotUserLabel(report.target, report.targetTag)} (${report.targetId})`}
				title={`Report ${report.id}`}
				trailing={
					<span
						className={cn(
							'rounded-full px-2.5 py-1 text-xs font-medium',
							STATE_PILL_CLASSES[report.state] ?? 'bg-on-tertiary text-secondary',
						)}
					>
						{STATE_LABELS[report.state] ?? report.state}
					</span>
				}
			/>

			<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<Field label="What was reported">
					{report.messageId ? (
						<div className="flex flex-col gap-2">
							{report.messageContent?.trim().length ? (
								// The same renderer the ModMail thread view and the AMA/panel previews use, rather than a `<pre>`:
								// a reported message is Discord message content, so mentions, custom emoji and timestamps have
								// to render as Discord would show them. Raw text would leave staff reading `<@1234…>` and
								// deciding a report on the strength of it.
								<div className="max-h-64 overflow-auto break-words rounded-md bg-on-tertiary p-3 text-sm dark:bg-on-tertiary-dark">
									<DiscordMarkdown
										content={report.messageContent}
										forBot="AUTOMODERATOR"
										participants={typeof report.target === 'string' ? {} : { [report.target.id]: report.target }}
									/>
								</div>
							) : (
								<p className="text-secondary dark:text-secondary-dark">The message had no text content.</p>
							)}

							{report.messageImageUrl && (
								// External Discord CDN domain, not in next/image's remote-pattern allowlist -- same call as
								// `PublicAnswers.tsx`. The stored url is signed and expires, so an old report's image can
								// simply 404 here; the card in the reports channel keeps working because Discord re-hosted
								// the image against that message when it was posted.
								// eslint-disable-next-line @next/next/no-img-element
								<img
									alt="The reported attachment"
									className="max-h-64 w-fit max-w-full rounded-md"
									loading="lazy"
									referrerPolicy="no-referrer"
									src={report.messageImageUrl}
								/>
							)}

							{report.channelId && (
								// Copy rather than navigate: the message a report is about has often been deleted by the time
								// staff read it, so following the link mostly lands on nothing -- while the link itself is
								// still what you want to paste into a staff discussion.
								<Button
									className="w-fit text-sm text-misc-accent hover:underline"
									onPress={async () => {
										await navigator.clipboard.writeText(
											`https://discord.com/channels/${guildId}/${report.channelId}/${report.messageId}`,
										);
										setLinkCopied(true);
										setTimeout(() => setLinkCopied(false), 2_000);
									}}
								>
									{linkCopied ? 'Copied' : 'Copy Discord message link'}
								</Button>
							)}
						</div>
					) : (
						// An account-level report has no content to quote, so the account itself is the subject and gets
						// rendered as one. The caveat is not decoration: a reporter complaining about somebody's *profile*
						// is the common reason to file one of these, and the bot can see none of it -- a bio, pronouns and
						// display-name history are all absent from `GET /users/{id}`. Staff who don't know that will read
						// this panel as "there was nothing to see".
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-2">
								<DiscordUserAvatar
									className="h-10 w-10 rounded-full"
									initials={snapshotUserLabel(report.target, report.targetTag).slice(0, 2)}
									user={report.target}
								/>
								<div className="flex flex-col">
									<p className="text-primary dark:text-primary-dark">
										{snapshotUserLabel(report.target, report.targetTag)}
									</p>
									<p className="text-xs text-secondary dark:text-secondary-dark">{report.targetId}</p>
								</div>
							</div>

							<p className="text-secondary dark:text-secondary-dark">
								This report is about the account rather than a specific message. Bios, pronouns and display-name history
								are not available to the bot — open the profile in Discord to check those yourself.
							</p>
						</div>
					)}
				</Field>

				<Field label="Filed">{formatDate(new Date(report.createdAt))}</Field>

				{report.resolvedAt && (
					<Field label={report.state === 'ACTIONED' ? 'Actioned' : 'Dismissed'}>
						{formatDate(new Date(report.resolvedAt))}
						{report.resolvedByUser ? ` by ${snapshotUserLabel(report.resolvedByUser, null)}` : ''}
					</Field>
				)}

				{report.caseId !== null && (
					<Field label="Resulting case">
						<Link
							className="text-misc-accent hover:underline"
							href={`/dashboard/${guildId}/automoderator/cases/${report.caseId}`}
						>
							Case #{report.caseId}
						</Link>
					</Field>
				)}
			</div>

			<div className="flex flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<p className="text-sm font-medium text-primary dark:text-primary-dark">
					{reporterCountLabel(report.reporterCount)}
					{/* The route bounds how many it resolves, so a brigaded report shows a count larger than the list. */}
					{reporters.length < report.reporterCount ? ` — showing the first ${reporters.length}` : ''}
				</p>

				<div className="flex flex-col gap-2">
					{reporters.map((entry) => (
						<div className="flex flex-col gap-0.5" key={entry.reporterId}>
							<p className="text-sm text-primary dark:text-primary-dark">
								{snapshotUserLabel(entry.reporter, entry.reporterTag)}{' '}
								<span className="text-secondary dark:text-secondary-dark">({entry.reporterId})</span>
							</p>
							<p className="text-sm text-secondary dark:text-secondary-dark">{entry.reason}</p>
						</div>
					))}
				</div>
			</div>

			<Link
				className="text-sm text-misc-accent hover:underline"
				href={`/dashboard/${guildId}/automoderator/reports?search=${report.targetId}`}
			>
				See all reports about this account
			</Link>
		</div>
	);
}
