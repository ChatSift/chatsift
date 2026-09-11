'use client';

import { DiscordUserAvatar } from '@chatsift/web-core/components/DiscordUserAvatar';
import { EmptyState } from '@chatsift/web-core/components/EmptyState';
import { GenericAvatar } from '@chatsift/web-core/components/GenericAvatar';
import { Heading } from '@chatsift/web-core/components/Heading';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import type { APIUser, Snowflake } from '@discordjs/core';
import { FaPaintBrush } from 'react-icons/fa';
import { useModmailInstanceInterestLeads } from '@/api/routes/modmail';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { formatDate, getGuildAcronym } from '@/utils/util';

function userLabel(user: APIUser | Snowflake): string {
	if (typeof user === 'string') {
		return user;
	}

	return user.global_name ?? `${user.username}${user.discriminator === '0' ? '' : `#${user.discriminator}`}`;
}

/**
 * Servers that asked about a custom ModMail instance from their dashboard (#216), newest first. Read-only:
 * onboarding a partner is a `modmail_instances` row written by hand plus a compose service, so there is
 * nothing to action from here beyond knowing who to talk to -- see the runbook in docs/workflow.md.
 */
export function InstanceInterestList() {
	const { data: leads, error, isLoading } = useModmailInstanceInterestLeads();

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !leads) {
		return <Skeleton className="h-64 w-full" />;
	}

	return (
		<div className="flex flex-col gap-4">
			<Heading title="Custom instance interest" />

			{leads.length === 0 ? (
				<EmptyState
					icon={<FaPaintBrush className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
					subtitle="The upsell card on every ModMail dashboard writes here."
					title="Nobody has raised their hand yet"
				/>
			) : (
				<ul className="flex flex-col gap-3">
					{leads.map((lead) => (
						<li
							className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark md:flex-row md:items-start md:justify-between"
							key={lead.guild.id}
						>
							<div className="flex min-w-0 items-center gap-3">
								{/* `iconUrl` is null both for a server with no icon and for one the bot can no longer
									see -- `GenericAvatar`'s initials fallback covers either without a special case. */}
								<GenericAvatar
									assetURL={lead.guild.iconUrl ?? undefined}
									className="h-10 w-10 rounded-full"
									disableLink
									initials={getGuildAcronym(lead.guild.name)}
									isLoading={false}
								/>
								<div className="flex min-w-0 flex-col">
									<p className="truncate text-lg font-medium text-primary dark:text-primary-dark">{lead.guild.name}</p>
									<p className="truncate font-mono text-sm text-secondary dark:text-secondary-dark">{lead.guild.id}</p>
									{/* The whole reason to look at this list is deciding whether a lead is worth a custom
										deployment, and size is the first thing that answers that. Absent for a guild the bot
										can no longer see, which is the same case that leaves the card without an icon. */}
									{lead.guild.memberCount !== null && (
										<p className="text-sm text-secondary dark:text-secondary-dark">
											{lead.guild.memberCount.toLocaleString()} members
										</p>
									)}
									{lead.guild.vanityUrlCode && (
										<a
											className="truncate text-sm text-misc-accent underline underline-offset-2"
											href={`https://discord.gg/${lead.guild.vanityUrlCode}`}
											rel="noreferrer"
											target="_blank"
										>
											discord.gg/{lead.guild.vanityUrlCode}
										</a>
									)}
								</div>
							</div>

							<div className="flex min-w-0 items-center gap-3 md:justify-end">
								<DiscordUserAvatar
									className="h-10 w-10 rounded-full"
									initials={userLabel(lead.user)}
									user={lead.user}
								/>
								<div className="flex min-w-0 flex-col">
									<p className="truncate text-base text-primary dark:text-primary-dark">{userLabel(lead.user)}</p>
									<p className="truncate font-mono text-sm text-secondary dark:text-secondary-dark">
										{typeof lead.user === 'string' ? lead.user : lead.user.id}
									</p>
									<p className="text-xs text-secondary dark:text-secondary-dark">
										{formatDate(new Date(lead.createdAt))}
									</p>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
