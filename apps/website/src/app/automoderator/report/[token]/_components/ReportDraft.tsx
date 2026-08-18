'use client';

import type { APIUser, Snowflake } from '@discordjs/core';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { APIError } from '@/api/error';
import { useMe } from '@/api/routes/auth';
import type { AutomoderatorReportCandidateGuild } from '@/api/routes/automoderatorReports';
import { useAutomoderatorReportDraft, useSubmitAutomoderatorReportDraft } from '@/api/routes/automoderatorReports';
import { Button } from '@/components/common/Button';
import { DiscordUserAvatar } from '@/components/common/DiscordUserAvatar';
import { EmptyState } from '@/components/common/EmptyState';
import { Heading } from '@/components/common/Heading';
import { Skeleton } from '@/components/common/Skeleton';
import { TextAreaField } from '@/components/common/TextAreaField';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { URLS } from '@/utils/urls';
import { cn, formatDate } from '@/utils/util';

// `ssr: false` is load-bearing, not a perf nicety -- see `DiscordMarkdown.tsx`'s own doc comment on why its
// wasm parser cannot be evaluated server-side at all under Next's bundler.
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

export function ReportDraft() {
	const { token } = useParams<{ token: string }>();
	const { data: me, isLoading: isLoadingMe } = useMe();

	const { data, isLoading, error } = useAutomoderatorReportDraft(token, Boolean(me));
	const submit = useSubmitAutomoderatorReportDraft(token);

	const [guildId, setGuildId] = useState<string | null>(null);
	const [reason, setReason] = useState('');
	const [submitted, setSubmitted] = useState(false);

	if (isLoadingMe || (me && isLoading)) {
		return (
			<div className="flex flex-col gap-3">
				<Skeleton className="h-24 w-full rounded-lg" />
				<Skeleton className="h-24 w-full rounded-lg" />
			</div>
		);
	}

	if (!me) {
		return (
			<div className="flex flex-col gap-6">
				<Heading subtitle="Log in with Discord to finish the report you started." title="Finish your report" />
				<a
					className="w-fit rounded-md bg-misc-accent px-3 py-2.5 text-accent transition-opacity hover:opacity-90"
					href={URLS.API.login(`/automoderator/report/${token}`)}
				>
					Log in with Discord
				</a>
			</div>
		);
	}

	if (submitted) {
		return <EmptyState icon={<SvgAutoModerator height={28} width={28} />} title="Report sent" />;
	}

	if (error || !data) {
		// "Expired", "already submitted" and "this is not your link" deliberately collapse into one message: the
		// API distinguishes them, a reporter can act on none of the differences, and the recovery is identical.
		// A 5xx or a dropped connection is *not* in that set -- `retry: false` makes one transient failure final,
		// so telling somebody to re-run `/submit-report` there would send them round a loop that cannot help.
		const isGone = error instanceof APIError && (error.statusCode === 404 || error.statusCode === 403);

		return (
			<EmptyState
				icon={<SvgAutoModerator height={28} width={28} />}
				subtitle={
					isGone
						? 'This link has expired or was already used. Run /submit-report again in the DM to get a fresh one.'
						: 'We could not load your report just now. Reload the page in a moment — your draft is still saved.'
				}
				title={isGone ? 'Link expired' : 'Something went wrong'}
			/>
		);
	}

	const targetTag = typeof data.target === 'string' ? data.target : (data.target.global_name ?? data.target.username);

	// The two accounts a DM is between, so a mention of either renders as a name rather than a raw id. A group
	// DM's third participant is not resolvable here -- the draft carries their tag but not their user object --
	// and falls back to the id, which is what Discord itself shows for an unknown mention.
	const participants: Record<string, APIUser | Snowflake> = {
		[me.id]: me as unknown as APIUser,
		...(typeof data.target === 'string' ? {} : { [data.target.id]: data.target }),
	};

	return (
		<div className="flex flex-col gap-6">
			<Heading subtitle={`Reporting ${targetTag}`} title="Finish your report" />

			<section className="flex flex-col gap-3">
				<h2 className="text-sm font-medium text-secondary dark:text-secondary-dark">
					What the moderators will see ({data.messages.length} {data.messages.length === 1 ? 'message' : 'messages'})
				</h2>

				{data.messages.map((message) => (
					<div
						className={cn(
							'flex gap-3 rounded-lg border p-4',
							message.isSubject
								? 'border-misc-danger/40 bg-card dark:bg-card-dark'
								: 'border-on-secondary bg-card dark:border-on-secondary-dark dark:bg-card-dark',
						)}
						key={message.messageId}
					>
						<DiscordUserAvatar
							className="h-8 w-8 shrink-0 rounded-full"
							initials={message.authorTag.slice(0, 1)}
							user={participants[message.authorId] ?? message.authorId}
						/>

						<div className="min-w-0 flex-1">
							<div className="flex items-baseline justify-between gap-2">
								<span className="text-sm font-medium text-primary dark:text-primary-dark">
									{message.authorId === me.id ? 'You' : message.authorTag}
								</span>
								<span className="shrink-0 text-xs text-secondary dark:text-secondary-dark">
									{formatDate(new Date(message.timestamp))}
								</span>
							</div>

							{message.content ? (
								<div className="mt-1 break-words text-sm text-primary dark:text-primary-dark">
									<DiscordMarkdown content={message.content} forBot="AUTOMODERATOR" participants={participants} />
								</div>
							) : (
								<p className="mt-1 text-sm italic text-secondary dark:text-secondary-dark">(no text content)</p>
							)}

							{message.imageUrl && (
								// eslint-disable-next-line @next/next/no-img-element -- a Discord CDN url, not a bundled asset
								<img
									alt=""
									className="mt-2 max-h-64 w-fit rounded-md border border-on-secondary object-contain dark:border-on-secondary-dark"
									src={message.imageUrl}
								/>
							)}
						</div>
					</div>
				))}
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-sm font-medium text-secondary dark:text-secondary-dark">Which server is this for?</h2>

				{data.guilds.length === 0 ? (
					<p className="text-sm text-secondary dark:text-secondary-dark">
						There are no servers to report this to. You need to share a server with them that uses AutoModerator and
						accepts reports — if they are a member somewhere you are, that community might not be accepting reports.
					</p>
				) : (
					<div className="flex flex-col gap-2">
						{data.guilds.map((guild) => (
							<GuildChoice
								guild={guild}
								isSelected={guild.id === guildId}
								key={guild.id}
								onSelect={() => setGuildId(guild.id)}
							/>
						))}
					</div>
				)}
			</section>

			{data.guilds.length > 0 && (
				<>
					<TextAreaField
						id="report-reason"
						label="Why are you reporting this?"
						maxLength={1_000}
						onChange={setReason}
						placeholder="Harassment in DMs"
						value={reason}
					/>

					<Button
						className="w-fit rounded-md bg-misc-accent px-3 py-2.5 text-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
						isDisabled={!guildId || submit.isPending}
						onPress={async () => {
							if (!guildId) {
								return;
							}

							await submit.mutateAsync({ guildId, reason: reason.trim() || 'Reported from a DM' });
							setSubmitted(true);
						}}
					>
						{submit.isPending ? 'Sending…' : 'Send report'}
					</Button>
				</>
			)}
		</div>
	);
}

interface GuildChoiceProps {
	readonly guild: AutomoderatorReportCandidateGuild;
	readonly isSelected: boolean;
	onSelect(): void;
}

function GuildChoice({ guild, isSelected, onSelect }: GuildChoiceProps) {
	const iconUrl = guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` : null;

	return (
		<Button
			// Selection is otherwise conveyed by border/background alone, which a screen reader cannot see -- and
			// the submit button stays disabled until something is picked, so "which one is chosen" matters.
			aria-pressed={isSelected}
			className={cn(
				'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
				isSelected
					? 'border-misc-accent bg-on-tertiary dark:bg-on-tertiary-dark'
					: 'border-on-secondary bg-card hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark',
			)}
			onPress={onSelect}
		>
			{iconUrl ? (
				// eslint-disable-next-line @next/next/no-img-element -- a Discord CDN url, not a bundled asset
				<img alt="" className="h-8 w-8 rounded-full" src={iconUrl} />
			) : (
				<span className="flex h-8 w-8 items-center justify-center rounded-full bg-on-tertiary text-xs text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark">
					{guild.name.slice(0, 1)}
				</span>
			)}
			<span className="text-primary dark:text-primary-dark">{guild.name}</span>
		</Button>
	);
}
