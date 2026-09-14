import type { APIUser, Snowflake } from '@discordjs/core';
import { UserBadge } from '@/components/dashboard/UserBadge';

export interface StatUserEntry {
	count: number;
	id: string;
	storedTag: string | null;
	user: APIUser | Snowflake;
}

interface StatUserListProps {
	countLabel(count: number): string;
	readonly entries: readonly StatUserEntry[];
	readonly title: string;
}

/**
 * A short "who did the most of this" list inside an analytics card -- AutoModerator's busiest case authors and
 * Appeals' busiest deciders (#403). A `UserBadge` rather than a bare name, so an account reads the same here
 * as it does in the case browser and the appeals queue; the API caps these at five, so this never scrolls.
 */
export function StatUserList({ countLabel, entries, title }: StatUserListProps) {
	return (
		<div>
			<h3 className="mb-2 text-sm font-medium text-primary dark:text-primary-dark">{title}</h3>
			<ul className="flex flex-col gap-2">
				{entries.map((entry) => (
					<li className="flex items-center justify-between gap-3" key={entry.id}>
						<UserBadge id={entry.id} storedTag={entry.storedTag} user={entry.user} />
						<span className="shrink-0 text-sm text-secondary dark:text-secondary-dark">{countLabel(entry.count)}</span>
					</li>
				))}
			</ul>
		</div>
	);
}
