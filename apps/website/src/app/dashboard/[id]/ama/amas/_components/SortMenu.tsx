'use client';

import { useURLParam } from '@/hooks/useURLParam';

export type SortOption = 'newest' | 'oldest' | 'questions' | 'title';

const DEFAULT_SORT: SortOption = 'newest';

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
	{ value: 'newest', label: 'Newest first' },
	{ value: 'oldest', label: 'Oldest first' },
	{ value: 'title', label: 'Title (A-Z)' },
	{ value: 'questions', label: 'Most questions' },
];

function isSortOption(value: string): value is SortOption {
	return SORT_OPTIONS.some((option) => option.value === value);
}

export function useSortOption(): SortOption {
	const [sort] = useURLParam('sort');
	return sort && isSortOption(sort) ? sort : DEFAULT_SORT;
}

export function SortMenu() {
	const sort = useSortOption();
	const [, setSort] = useURLParam('sort');

	return (
		<select
			aria-label="Sort AMA sessions"
			className="h-10 rounded-md border border-on-secondary bg-card px-3 text-sm text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
			onChange={(e) => setSort(e.target.value === DEFAULT_SORT ? null : e.target.value)}
			value={sort}
		>
			{SORT_OPTIONS.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	);
}
