'use client';

import { useModmailCategories } from '@/api/routes/modmail';
import { Emoji } from '@/components/common/Emoji';
import { Skeleton } from '@/components/common/Skeleton';

interface CategoryCheckboxListProps {
	readonly error?: string | undefined;
	readonly guildId: string;
	onChange(categoryIds: number[]): void;
	readonly value: number[];
}

export function CategoryCheckboxList({ guildId, value, onChange, error }: CategoryCheckboxListProps) {
	const { data: categories, isLoading } = useModmailCategories(guildId);

	const toggle = (categoryId: number) => {
		onChange(value.includes(categoryId) ? value.filter((id) => id !== categoryId) : [...value, categoryId]);
	};

	return (
		<div>
			<p className="mb-2 block text-sm font-medium text-secondary dark:text-secondary-dark">Categories *</p>

			{isLoading ? (
				<div className="space-y-2">
					<Skeleton className="h-6 w-full" />
					<Skeleton className="h-6 w-full" />
				</div>
			) : categories?.length ? (
				<div className="space-y-2">
					{categories.map((category) => (
						<label className="flex items-center gap-2" htmlFor={`panel-category-${category.id}`} key={category.id}>
							<input
								checked={value.includes(category.id)}
								className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
								id={`panel-category-${category.id}`}
								onChange={() => toggle(category.id)}
								type="checkbox"
							/>
							<span className="flex items-center gap-1 text-sm text-primary dark:text-primary-dark">
								{category.emoji && <Emoji className="h-4 w-4" value={category.emoji} />}
								{category.name}
							</span>
						</label>
					))}
				</div>
			) : (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					No categories configured yet — create one on the Categories page first.
				</p>
			)}
			{error && <p className="mt-1 text-sm text-misc-danger">{error}</p>}
		</div>
	);
}
