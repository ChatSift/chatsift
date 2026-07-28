'use client';

import type { APIUser, Snowflake } from '@discordjs/core';
import { useState } from 'react';
import { FaLock } from 'react-icons/fa';
import type { ModmailThreadMessage } from '@/api/routes/modmailThreads';
import { UserAvatar } from '@/components/user/UserAvatar';
import { cn, discordSnowflakeToDate, formatDate } from '@/utils/util';

interface ThreadMessageProps {
	readonly message: ModmailThreadMessage;
	readonly messagesById: ReadonlyMap<ModmailThreadMessage['id'], ModmailThreadMessage>;
	readonly participants: Record<string, APIUser | Snowflake>;
}

function participantLabel(entry: APIUser | Snowflake | undefined, fallbackId: string): string {
	if (!entry) {
		return fallbackId;
	}

	return typeof entry === 'string' ? entry : (entry.global_name ?? entry.username);
}

function messageAuthorId(message: ModmailThreadMessage): string {
	// `staffId` is always the real staff member regardless of `anon` -- `anon` only controls what the *user*
	// sees (relayed as a generic "staff" label in their own thread), never what's recorded here. Staff viewing
	// this dashboard always see who actually sent it, with a badge noting it went out anonymously.
	return message.staffId ?? message.userId;
}

type RecordedSticker = NonNullable<ModmailThreadMessage['recordedContent']>['stickers'][number];

/**
 * Discord's sticker CDN -- static formats (`PNG`/`APNG`, format types 1/2) are served from the plain
 * CDN host, animated `GIF` stickers (format type 4) only render through the media proxy host. `Lottie`
 * (format type 3, vector animation) has no static image at all -- rendering that properly would need a
 * Lottie player, out of scope for this pass, so it just falls back to a name chip.
 */
function stickerImageUrl(sticker: RecordedSticker): string | undefined {
	switch (sticker.formatType) {
		case 1:
		case 2:
			return `https://cdn.discordapp.com/stickers/${sticker.id}.png?size=160`;
		case 4:
			return `https://media.discordapp.net/stickers/${sticker.id}.gif?size=160`;
		default:
			return undefined;
	}
}

export function ThreadMessage({ message, messagesById, participants }: ThreadMessageProps) {
	const [showReply, setShowReply] = useState(false);

	const isStaff = message.staffId !== null;
	const authorId = messageAuthorId(message);
	const authorEntry = participants[authorId];
	const authorLabel = participantLabel(authorEntry, authorId);
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
					'rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3 dark:border-amber-400/30 dark:bg-amber-400/5',
			)}
		>
			{authorEntry && typeof authorEntry !== 'string' ? (
				<UserAvatar className="h-8 w-8 shrink-0 rounded-full" isLoading={false} user={authorEntry} />
			) : (
				<div className="h-8 w-8 shrink-0 rounded-full bg-on-tertiary dark:bg-on-tertiary-dark" />
			)}

			<div className="min-w-0 flex-1">
				{message.isInternal && (
					<div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
						<FaLock className="h-3 w-3" />
						Internal message
					</div>
				)}

				<div className="flex flex-wrap items-baseline gap-2">
					<span className="font-medium text-primary dark:text-primary-dark">{authorLabel}</span>
					{isStaff && (
						<span className="rounded bg-on-tertiary px-1.5 py-0.5 text-xs text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark">
							Staff
						</span>
					)}
					{message.anon && (
						<span className="rounded bg-on-tertiary px-1.5 py-0.5 text-xs text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark">
							Sent anonymously
						</span>
					)}
					<span className="text-xs text-secondary dark:text-secondary-dark">
						{formatDate(timestamp)}
						{message.recordedContent?.isForwarded && ' · forwarded'}
					</span>
				</div>

				{repliedToId !== null && (
					<button
						className="mt-1 block text-xs text-misc-accent hover:underline"
						onClick={() => setShowReply((previous) => !previous)}
						type="button"
					>
						{showReply ? 'Hide' : 'Show'} reply
						{repliedTo
							? ` to ${participantLabel(participants[messageAuthorId(repliedTo)], messageAuthorId(repliedTo))}`
							: ''}
					</button>
				)}
				{showReply && repliedToId !== null && (
					<div className="mt-1 whitespace-pre-wrap rounded border-l-2 border-on-secondary pl-2 text-sm text-secondary dark:border-on-secondary-dark dark:text-secondary-dark">
						{repliedTo ? (repliedTo.recordedContent?.content ?? '(not recorded)') : '(message not loaded on this page)'}
					</div>
				)}

				{message.recordedContent?.content && (
					<p className="mt-1 whitespace-pre-wrap text-sm text-primary dark:text-primary-dark">
						{message.recordedContent.content}
					</p>
				)}
				{message.recordedContent && !message.recordedContent.content && !hasAttachments && !hasStickers && (
					<p className="mt-1 text-sm italic text-secondary dark:text-secondary-dark">(no text content)</p>
				)}
				{!message.recordedContent && (
					<p className="mt-1 text-sm italic text-secondary dark:text-secondary-dark">Not recorded</p>
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
