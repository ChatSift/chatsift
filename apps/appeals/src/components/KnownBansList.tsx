'use client';

import type { GuildSummary } from '@chatsift/api';
import Link from 'next/link';
import { GuildBadge } from './GuildBadge';

/**
 * Servers that accept appeals where this appellant is currently banned -- the first thing they see after signing
 * in, and the reason the common case needs no invite pasted at all.
 *
 * The copy is careful, and has to stay careful: this is **not** every server they are banned in, and it cannot
 * be (#232 §4). Bans issued before the Appeals bot joined a guild, bans during downtime, and every server that
 * does not use Appeals are all missing, permanently. Somebody who took this for a complete list and saw a
 * server absent would conclude they were not banned there, which we have no basis to claim -- hence the
 * subtitle naming the gap and pointing at the invite box rather than leaving them to guess.
 */
export function KnownBansList({ guilds }: { readonly guilds: readonly GuildSummary[] }) {
	if (guilds.length === 0) {
		return null;
	}

	return (
		<section className="flex flex-col gap-3">
			<div>
				<h2 className="text-lg font-medium text-primary dark:text-primary-dark">Known bans</h2>
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Note that this is not an exhaustive list of your bans. If this list does not include the ban you are looking
					for, provide an invite to that server below.
				</p>
			</div>

			{guilds.map((guild) => (
				<Link
					className="flex items-center justify-between gap-3 rounded-lg border border-on-secondary bg-card p-4 transition-colors hover:bg-on-tertiary dark:border-on-secondary-dark dark:bg-card-dark dark:hover:bg-on-tertiary-dark"
					href={`/g/${guild.id}`}
					key={guild.id}
				>
					<GuildBadge guild={guild} />
					<span className="text-sm text-misc-accent">Appeal</span>
				</Link>
			))}
		</section>
	);
}
