'use client';

import type { GuildSummary } from '@chatsift/api';
import Link from 'next/link';
import { GuildBadge } from './GuildBadge';

/**
 * Servers the appellant has checked here and is still banned in.
 *
 * The copy is careful, and has to stay careful: this is **not** a list of every server they are banned in, and
 * reading it as one is a mistake the product cannot back up (#232 §4). Nothing populates it except this
 * appellant's own visits, so "you have checked" is the honest framing and the subtitle says so outright --
 * somebody who takes this for a complete list and sees a server missing would conclude they are not banned
 * there, which we have no basis to claim.
 */
export function KnownBansList({ guilds }: { readonly guilds: readonly GuildSummary[] }) {
	if (guilds.length === 0) {
		return null;
	}

	return (
		<section className="flex flex-col gap-3">
			<div>
				<h2 className="text-lg font-medium text-primary dark:text-primary-dark">Pick up where you left off</h2>
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Servers you have checked here and are still banned in. This is not every server you are banned in -- only the
					ones you have looked up.
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
