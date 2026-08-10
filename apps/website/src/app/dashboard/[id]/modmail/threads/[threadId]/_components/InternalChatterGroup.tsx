'use client';

import type { APIUser, Snowflake } from '@discordjs/core';
import { useState } from 'react';
import { FaChevronDown, FaChevronRight, FaLock } from 'react-icons/fa';
import { ThreadMessage } from './ThreadMessage';
import type { ModmailThreadMessage } from '@/api/routes/modmailThreads';

interface InternalChatterGroupProps {
	readonly messages: ModmailThreadMessage[];
	readonly messagesById: ReadonlyMap<ModmailThreadMessage['id'], ModmailThreadMessage>;
	readonly participants: Record<string, APIUser | Snowflake>;
}

/**
 * A run of two or more consecutive internal mod-thread messages, collapsed by default (Phase 3 must,
 * #261) -- a back-and-forth of internal notes between two real relayed messages shouldn't force scrolling
 * through all of it. Still visually distinct (dashed amber) even collapsed, matching each internal
 * message's own styling, so it's never mistaken for part of the real user-facing exchange.
 */
export function InternalChatterGroup({ messages, messagesById, participants }: InternalChatterGroupProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div className="rounded-lg border border-dashed border-misc-warning/40 bg-misc-warning/5 dark:border-misc-warning-dark/30 dark:bg-misc-warning-dark/5">
			<button
				aria-expanded={isExpanded}
				className="flex w-full items-center gap-1.5 p-3 text-left text-xs font-medium text-misc-warning dark:text-misc-warning-dark"
				onClick={() => setIsExpanded((previous) => !previous)}
				type="button"
			>
				{isExpanded ? <FaChevronDown className="h-3 w-3" /> : <FaChevronRight className="h-3 w-3" />}
				<FaLock className="h-3 w-3" />
				{messages.length} internal messages
			</button>

			{isExpanded && (
				<div className="flex flex-col gap-4 border-t border-dashed border-misc-warning/40 p-3 dark:border-misc-warning-dark/30">
					{messages.map((message) => (
						<ThreadMessage
							isGroupedInternal
							key={message.id}
							message={message}
							messagesById={messagesById}
							participants={participants}
							showHeader
						/>
					))}
				</div>
			)}
		</div>
	);
}
