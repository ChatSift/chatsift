'use client';

import { useParams } from 'next/navigation';
import { AddCategoryCard } from './AddCategoryCard';
import { CategoryCard } from './CategoryCard';
import { useModmailCategories, useReorderModmailCategories } from '@/api/routes/modmail';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

export function CategoriesList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: categories, isLoading, error } = useModmailCategories(guildId);
	const reorderCategories = useReorderModmailCategories(guildId);

	// See GrantsList.tsx for why this also checks `categories === undefined`: a background refetch failure keeps
	// the previously-cached list around, and that stale-but-present data should keep rendering normally rather
	// than being replaced by the full error state.
	if (error && categories === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<>
				<AddCategoryCard guildId={guildId} />
				<Skeleton className="h-48 w-full rounded-lg" />
				<Skeleton className="h-48 w-full rounded-lg" />
			</>
		);
	}

	// Swaps the category at `index` with its neighbor at `index + direction`, then renumbers the whole list to
	// sequential 0..n-1 `sortOrder` values and patches only the entries that actually changed -- always
	// renumbering from scratch (rather than just swapping the two `sortOrder` values) keeps every category's
	// `sortOrder` clean and gap-free even if older rows had arbitrary values from before this UI existed.
	const move = async (index: number, direction: -1 | 1) => {
		const oldSortOrderById = new Map(categories!.map((category) => [category.id, category.sortOrder]));

		const reordered = [...categories!];
		const neighborIndex = index + direction;
		[reordered[index], reordered[neighborIndex]] = [reordered[neighborIndex]!, reordered[index]!];

		const updates = reordered
			.map((category, newIndex) => ({ categoryId: category.id, sortOrder: newIndex }))
			.filter(({ categoryId, sortOrder }) => oldSortOrderById.get(categoryId) !== sortOrder);

		await reorderCategories.mutateAsync(updates);
	};

	return (
		<>
			<AddCategoryCard guildId={guildId} />
			{categories!.map((category, index) => (
				<CategoryCard
					canMoveDown={index < categories!.length - 1}
					canMoveUp={index > 0}
					category={category}
					guildId={guildId}
					key={category.id}
					onMoveDown={async () => move(index, 1)}
					onMoveUp={async () => move(index, -1)}
				/>
			))}
		</>
	);
}
