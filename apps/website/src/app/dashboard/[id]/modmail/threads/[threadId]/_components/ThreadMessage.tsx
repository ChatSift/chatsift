'use client';

import type { APIUser, Snowflake } from '@discordjs/core';
import dynamic from 'next/dynamic';
import { FaLock, FaRobot, FaTrash } from 'react-icons/fa';
import { EditHistoryBadge } from './EditHistoryBadge';
import { MessageAuthorHeader } from './MessageAuthorHeader';
import { messageAuthorId, resolveAuthorLabel, stickerImageUrl } from './threadMessageUtils';
import type { ModmailThreadMessage } from '@/api/routes/modmailThreads';
import { Skeleton } from '@/components/common/Skeleton';
import { UserAvatar } from '@/components/user/UserAvatar';
import { cn, discordSnowflakeToDate, formatDate } from '@/utils/util';

// `ssr: false` is load-bearing, not just a perf nicety -- see `DiscordMarkdown.tsx`'s own doc comment on
// why its wasm parser can't be evaluated server-side at all under Next's bundler.
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

interface ThreadMessageProps {
	/**
	 * `true` when rendered as a child of `InternalChatterGroup` -- that component's own dashed-box container
	 * and "N internal messages" header already establish the "this is internal" framing, so each individual
	 * message here skips its own redundant border and "Internal message" label rather than nesting them.
	 */
	readonly isGroupedInternal?: boolean;
	readonly message: ModmailThreadMessage;
	readonly messagesById: ReadonlyMap<ModmailThreadMessage['id'], ModmailThreadMessage>;
	readonly onJumpToMessage?: ((messageId: number) => void) | undefined;
	readonly participants: Record<string, APIUser | Snowflake>;
	/**
	 * `false` suppresses the avatar/name/timestamp header for a message grouped under the one above it
	 * (Phase 3 must, #261 -- see `threadMessageUtils.ts#buildRenderItems`). Defaults to `true` so a message
	 * rendered standalone (e.g. inside `InternalChatterGroup`) always shows its own header.
	 */
	readonly showHeader?: boolean;
}

export function ThreadMessage({
	message,
	messagesById,
	participants,
	onJumpToMessage,
	showHeader = true,
	isGroupedInternal = false,
}: ThreadMessageProps) {
	const isStaff = message.staffId !== null;
	const authorId = messageAuthorId(message);
	// A system message with no `staffId` (the greeting, or an anonymized farewell) has no real actor to
	// resolve -- `messageAuthorId` would otherwise fall back to `userId` and misattribute it to the ticket's
	// own user, since that column is always populated even for these rows (see schema.sql's own doc
	// comment). An *attributed* farewell still resolves normally, since `staffId` is genuinely the closer.
	const isUnattributedSystemMessage = message.isSystem && !isStaff;
	const authorEntry = isUnattributedSystemMessage ? undefined : participants[authorId];
	const authorLabel = resolveAuthorLabel(message, participants);
	const timestamp = discordSnowflakeToDate(message.guildMessageId);

	const repliedToId = message.recordedContent?.repliedToThreadMessageId ?? null;
	const repliedTo = repliedToId === null ? undefined : messagesById.get(repliedToId);

	const hasAttachments = Boolean(message.recordedContent?.attachments.length);
	const hasStickers = Boolean(message.recordedContent?.stickers.length);

	return (
		<div
			className={cn(
				'flex gap-3',
				message.isInternal &&
					!isGroupedInternal &&
					'rounded-lg border border-dashed border-misc-warning/40 bg-misc-warning/5 p-3 dark:border-misc-warning-dark/30 dark:bg-misc-warning-dark/5',
				message.isSystem &&
					'rounded-lg border border-misc-system/30 bg-misc-system/5 p-3 dark:border-misc-system-dark/20 dark:bg-misc-system-dark/5',
			)}
		>
			{showHeader ? (
				authorEntry && typeof authorEntry !== 'string' ? (
					<UserAvatar className="h-8 w-8 shrink-0 rounded-full" isLoading={false} user={authorEntry} />
				) : isUnattributedSystemMessage ? (
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-misc-system/10 text-misc-system dark:bg-misc-system-dark/10 dark:text-misc-system-dark">
						<FaRobot className="h-4 w-4" />
					</div>
				) : (
					<div className="h-8 w-8 shrink-0 rounded-full bg-on-tertiary dark:bg-on-tertiary-dark" />
				)
			) : (
				<div className="w-8 shrink-0" />
			)}

			<div className="min-w-0 flex-1">
				{showHeader && message.isInternal && !isGroupedInternal && (
					<div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-misc-warning dark:text-misc-warning-dark">
						<FaLock className="h-3 w-3" />
						Internal message
					</div>
				)}

				{showHeader && message.isSystem && (
					<div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-misc-system dark:text-misc-system-dark">
						<FaRobot className="h-3 w-3" />
						Automated message
					</div>
				)}

				{showHeader && (
					<MessageAuthorHeader
						anon={message.anon}
						authorLabel={authorLabel}
						isForwarded={Boolean(message.recordedContent?.isForwarded)}
						isStaff={isStaff}
						timestamp={timestamp}
					/>
				)}

				{repliedToId !== null && (
					<button
						className={cn(
							'mt-1 flex max-w-full items-center gap-1 rounded border-l-2 border-on-secondary pl-2 text-left text-xs text-secondary dark:border-on-secondary-dark dark:text-secondary-dark',
							repliedTo && onJumpToMessage && 'hover:text-primary hover:underline dark:hover:text-primary-dark',
						)}
						disabled={!repliedTo || !onJumpToMessage}
						onClick={() => {
							if (repliedTo && onJumpToMessage) {
								onJumpToMessage(repliedTo.id);
							}
						}}
						type="button"
					>
						<span className="shrink-0">↩ {repliedTo ? resolveAuthorLabel(repliedTo, participants) : ''}</span>
						<span className="truncate">
							{repliedTo
								? (repliedTo.recordedContent?.content ?? '(not recorded)')
								: '(message not loaded on this page)'}
						</span>
					</button>
				)}

				{message.recordedContent?.content && (
					<div className="mt-1 break-words text-sm text-primary dark:text-primary-dark">
						<DiscordMarkdown content={message.recordedContent.content} forBot="MODMAIL" participants={participants} />
					</div>
				)}
				{message.recordedContent && !message.recordedContent.content && !hasAttachments && !hasStickers && (
					<p className="mt-1 text-sm italic text-secondary dark:text-secondary-dark">(no text content)</p>
				)}
				{!message.recordedContent && (
					<p className="mt-1 text-sm italic text-secondary dark:text-secondary-dark">Not recorded</p>
				)}
				{message.recordedContent && message.recordedContent.editCount > 0 && (
					<p className="mt-0.5">
						<EditHistoryBadge messageId={message.id} />
					</p>
				)}

				{message.deletedAt && (
					<div className="mt-1 flex items-center gap-1 text-xs text-misc-danger">
						<FaTrash className="h-2.5 w-2.5" />
						Deleted {formatDate(new Date(message.deletedAt))}
					</div>
				)}

				{hasStickers && (
					<div className="mt-2 flex flex-wrap gap-2">
						{message.recordedContent!.stickers.map((sticker) => {
							const imageUrl = stickerImageUrl(sticker);
							return imageUrl ? (
								// eslint-disable-next-line @next/next/no-img-element
								<img alt={sticker.name} className="h-20 w-20 object-contain" key={sticker.id} src={imageUrl} />
							) : (
								<span
									className="rounded bg-on-tertiary px-2 py-1 text-xs text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark"
									key={sticker.id}
									title="Animated (Lottie) sticker -- preview not supported"
								>
									Sticker: {sticker.name}
								</span>
							);
						})}
					</div>
				)}

				{hasAttachments && (
					<div className="mt-2 flex flex-wrap gap-2">
						{message.recordedContent!.attachments.map((attachment) =>
							attachment.available ? (
								<a
									className="text-xs text-misc-accent hover:underline"
									href={attachment.url}
									key={attachment.filename}
									rel="noreferrer"
									target="_blank"
								>
									{attachment.filename}
								</a>
							) : (
								<span
									className="text-xs text-secondary line-through dark:text-secondary-dark"
									key={attachment.filename}
									title="Attachment no longer exists on Discord"
								>
									{attachment.filename}
								</span>
							),
						)}
					</div>
				)}
			</div>
		</div>
	);
}
