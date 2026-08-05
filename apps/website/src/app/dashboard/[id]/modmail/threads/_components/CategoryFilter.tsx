'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useModmailCategories } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { Emoji } from '@/components/common/Emoji';
import { SvgChevronDown } from '@/components/icons/SvgChevronDown';
import { useURLParam } from '@/hooks/useURLParam';
import { cn } from '@/utils/util';

export function useCategoryFilter(): number | undefined {
	const [categoryParam] = useURLParam('category');
	const categoryId = categoryParam ? Number(categoryParam) : undefined;
	return categoryId !== undefined && Number.isFinite(categoryId) ? categoryId : undefined;
}

export function CategoryFilter() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: categories } = useModmailCategories(guildId);
	const categoryId = useCategoryFilter();
	const [, setCategoryParam] = useURLParam('category');
	const [isOpen, setIsOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen]);

	// No point filtering by category when the guild has none configured -- keep the toolbar as it was for
	// those guilds rather than showing a filter that can never do anything.
	if (!categories?.length) {
		return null;
	}

	const selected = categories.find((category) => category.id === categoryId);

	const handleSelect = (nextCategoryId: number | undefined) => {
		setCategoryParam(nextCategoryId ? String(nextCategoryId) : null);
		setIsOpen(false);
	};

	return (
		<div className="relative" ref={ref}>
			<Button
				aria-label="Filter by category"
				className="h-10 border border-on-secondary px-3 text-sm text-primary dark:border-on-secondary-dark dark:text-primary-dark"
				onClick={() => setIsOpen(!isOpen)}
				type="button"
			>
				{selected ? (
					<span className="flex items-center gap-1.5">
						{selected.emoji && <Emoji className="h-3.5 w-3.5" value={selected.emoji} />}
						{selected.name}
					</span>
				) : (
					<span className="text-secondary dark:text-secondary-dark">All categories</span>
				)}
				<SvgChevronDown className={cn('transition-transform', isOpen && 'rotate-180')} size={14} />
			</Button>

			{isOpen && (
				<div className="absolute right-0 z-50 mt-1 min-w-full whitespace-nowrap rounded-md border border-on-secondary bg-card shadow-lg dark:border-on-secondary-dark dark:bg-card-dark">
					<Button
						className={cn(
							'w-full justify-start rounded-none px-3 py-2 text-left text-sm',
							!categoryId && 'bg-misc-accent/10 text-misc-accent',
						)}
						onClick={() => handleSelect(undefined)}
					>
						All categories
					</Button>
					{categories.map((category) => (
						<Button
							className={cn(
								'w-full justify-start rounded-none px-3 py-2 text-left text-sm',
								category.id === categoryId && 'bg-misc-accent/10 text-misc-accent',
							)}
							key={category.id}
							onClick={() => handleSelect(category.id)}
						>
							<span className="flex items-center gap-1.5">
								{category.emoji && <Emoji className="h-3.5 w-3.5" value={category.emoji} />}
								{category.name}
							</span>
						</Button>
					))}
				</div>
			)}
		</div>
	);
}
