'use client';

import Link from 'next/link';
import { useGuildInfo } from '@/api/routes/guilds';
import { useModForumTags } from '@/api/routes/modmail';
import type { ModmailThreadDetail } from '@/api/routes/modmailThreads';
import { Emoji } from '@/components/common/Emoji';
import { Skeleton } from '@/components/common/Skeleton';
import { UserAvatar } from '@/components/user/UserAvatar';
import { formatDate } from '@/utils/util';

interface ThreadSidebarProps {
	readonly guildId: string;
	readonly thread: ModmailThreadDetail;
}

export function ThreadSidebar({ guildId, thread }: ThreadSidebarProps) {
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'MODMAIL');
	const { tags, isLoading: isTagsLoading } = useModForumTags(guildId);

	const isClosed = thread.closedAt !== null;
	const user = thread.member?.user;
	const roleIds = thread.member?.roles ?? [];
	const roles = roleIds
		.map((roleId) => guildInfo?.roles.find((role) => role.id === roleId))
		.filter((role) => role !== undefined);

	const appliedTags = thread.appliedTagIds
		.map((tagId) => tags?.find((tag) => tag.id === tagId))
		.filter((tag) => tag !== undefined);

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex items-center gap-3">
				{user ? (
					<UserAvatar className="h-12 w-12 rounded-full" isLoading={false} user={user} />
				) : (
					<div className="h-12 w-12 shrink-0 rounded-full bg-on-tertiary dark:bg-on-tertiary-dark" />
				)}
				<div className="flex flex-col overflow-hidden">
					<p className="truncate text-lg font-medium text-primary dark:text-primary-dark">
						{user?.global_name ?? user?.username ?? thread.userId}
					</p>
					{!thread.member && (
						<p className="text-xs text-secondary dark:text-secondary-dark">No longer a member of this server</p>
					)}
				</div>
			</div>

			<div>
				<span
					className={
						isClosed
							? 'rounded-full bg-on-tertiary px-2.5 py-1 text-xs font-medium text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark'
							: 'rounded-full bg-misc-accent/10 px-2.5 py-1 text-xs font-medium text-misc-accent'
					}
				>
					{isClosed ? 'Closed' : 'Open'}
				</span>
			</div>

			<div className="flex flex-col gap-1 text-sm">
				<p className="text-secondary dark:text-secondary-dark">Opened {formatDate(new Date(thread.createdAt))}</p>
				{thread.closedAt && (
					<p className="text-secondary dark:text-secondary-dark">Closed {formatDate(new Date(thread.closedAt))}</p>
				)}
			</div>

			<div>
				<p className="mb-1 text-sm font-medium text-secondary dark:text-secondary-dark">Category</p>
				{thread.category ? (
					<span className="flex w-fit items-center gap-1 rounded-full bg-on-tertiary px-2.5 py-1 text-xs font-medium text-primary dark:bg-on-tertiary-dark dark:text-primary-dark">
						{thread.category.emoji && <Emoji className="h-3 w-3" value={thread.category.emoji} />}
						{thread.category.name}
					</span>
				) : (
					<p className="text-sm text-secondary dark:text-secondary-dark">No category</p>
				)}
			</div>

			<div>
				<p className="mb-1 text-sm font-medium text-secondary dark:text-secondary-dark">Forum Tags</p>
				{isTagsLoading ? (
					<Skeleton className="h-5 w-24" />
				) : appliedTags.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{appliedTags.map((tag) => (
							<span
								className="flex items-center gap-1 rounded-full bg-on-tertiary px-2.5 py-1 text-xs font-medium text-primary dark:bg-on-tertiary-dark dark:text-primary-dark"
								key={tag.id}
							>
								{tag.emoji_id ? <Emoji className="h-3 w-3" value={`<:${tag.name}:${tag.emoji_id}>`} /> : tag.emoji_name}
								{tag.name}
							</span>
						))}
					</div>
				) : (
					<p className="text-sm text-secondary dark:text-secondary-dark">No tags applied</p>
				)}
			</div>

			<div>
				<p className="mb-1 text-sm font-medium text-secondary dark:text-secondary-dark">Roles</p>
				{isGuildInfoLoading ? (
					<Skeleton className="h-5 w-24" />
				) : roles.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{roles.map((role) => (
							<span
								className="rounded-full bg-on-tertiary px-2.5 py-1 text-xs font-medium text-primary dark:bg-on-tertiary-dark dark:text-primary-dark"
								key={role.id}
							>
								{role.name}
							</span>
						))}
					</div>
				) : (
					<p className="text-sm text-secondary dark:text-secondary-dark">No roles</p>
				)}
			</div>

			<div>
				<p className="mb-1 text-sm font-medium text-secondary dark:text-secondary-dark">
					Thread History ({thread.userThreadCount})
				</p>
				{thread.otherThreads.length > 0 ? (
					<div className="flex flex-col gap-1">
						{thread.otherThreads.map((otherThread) => (
							<Link
								className="text-sm text-misc-accent hover:underline"
								href={`/dashboard/${guildId}/modmail/threads/${otherThread.id}`}
								key={otherThread.id}
							>
								Thread #{otherThread.id} &middot; {formatDate(new Date(otherThread.createdAt))}
								{otherThread.closedAt === null && ' (open)'}
							</Link>
						))}
					</div>
				) : (
					<p className="text-sm text-secondary dark:text-secondary-dark">No other threads from this user</p>
				)}
			</div>
		</div>
	);
}
