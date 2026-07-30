'use client';

import { useParams } from 'next/navigation';
import { useModmailConfig } from '@/api/routes/modmail';

/**
 * Panels themselves are untouched by DM mode in P4 -- a click is only made inert in P5 (decision 9 in
 * docs/roadmap/01-architecture.md §8). This banner is the read-only half of that: telling
 * whoever's looking at this page why a panel they might still see posted in the server won't do
 * anything useful for a user right now.
 */
export function DmModeBanner() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: config } = useModmailConfig(guildId);

	if (!config?.dmMode) {
		return null;
	}

	return (
		<p
			className="rounded-lg border border-misc-accent bg-misc-accent/10 p-3 text-sm text-misc-accent md:col-span-2 lg:col-span-3"
			role="status"
		>
			This server uses DM mode — users open tickets by DMing the bot directly. Panels posted below won&apos;t do
			anything useful for them while it&apos;s on.
		</p>
	);
}
