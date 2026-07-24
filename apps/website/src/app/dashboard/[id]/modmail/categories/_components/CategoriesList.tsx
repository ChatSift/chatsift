'use client';

import { useParams } from 'next/navigation';
import { AddCategoryCard } from './AddCategoryCard';
import { CategoryCard } from './CategoryCard';
import { useModmailCategories } from '@/api/routes/modmail';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

export function CategoriesList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: categories, isLoading, error } = useModmailCategories(guildId);

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

	return (
		<>
			<AddCategoryCard guildId={guildId} />
			{categories!.map((category) => (
				<CategoryCard category={category} guildId={guildId} key={category.id} />
			))}
		</>
	);
}
