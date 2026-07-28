'use client';

import type { APIUser, Snowflake } from '@discordjs/core';
import { formatDate } from '@/utils/util';

interface MessageAuthorHeaderProps {
	readonly anon: boolean;
	readonly authorLabel: string;
	readonly isForwarded: boolean;
	readonly isStaff: boolean;
	readonly timestamp: Date;
}

/**
 * Extracted from `ThreadMessage.tsx` (Phase 3, #261) so consecutive messages from the same author can
 * suppress it (`ThreadMessageList.tsx`'s grouping, see `threadMessageUtils.ts#buildRenderItems`) without
 * duplicating the avatar/name/badges/timestamp markup at each call site.
 */
export function MessageAuthorHeader({ anon, authorLabel, isForwarded, isStaff, timestamp }: MessageAuthorHeaderProps) {
	return (
		<div className="flex flex-wrap items-baseline gap-2">
			<span className="font-medium text-primary dark:text-primary-dark">{authorLabel}</span>
			{isStaff && (
				<span className="rounded bg-on-tertiary px-1.5 py-0.5 text-xs text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark">
					Staff
				</span>
			)}
			{anon && (
				<span className="rounded bg-on-tertiary px-1.5 py-0.5 text-xs text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark">
					Sent anonymously
				</span>
			)}
			{isForwarded && (
				<span className="rounded bg-on-tertiary px-1.5 py-0.5 text-xs text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark">
					📨 Forwarded
				</span>
			)}
			<span className="text-xs text-secondary dark:text-secondary-dark">{formatDate(timestamp)}</span>
		</div>
	);
}
