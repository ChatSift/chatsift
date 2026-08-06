'use client';

import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { useAMATags } from '@/api/routes/ama';
import { Button } from '@/components/common/Button';
import { SvgChevronDown } from '@/components/icons/SvgChevronDown';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useURLParam } from '@/hooks/useURLParam';
import { cn } from '@/utils/util';

export function useTagFilter(): number | undefined {
	const [tagParam] = useURLParam('tag');
	const tagId = tagParam ? Number(tagParam) : undefined;
	return tagId !== undefined && Number.isFinite(tagId) ? tagId : undefined;
}

/**
 * Mirrors `CategoryFilter.tsx`'s click-outside dropdown exactly -- same shape, different backing data
 * (session-scoped tags instead of guild-wide ModMail categories).
 */
export function QuestionTagFilter() {
	const { id: guildId, amaId } = useParams<{ amaId: string; id: string }>();
	const { data: tags } = useAMATags(guildId, amaId);
	const tagId = useTagFilter();
	const [, setTagParam] = useURLParam('tag');
	const [isOpen, setIsOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useClickOutside(ref, isOpen, () => setIsOpen(false));

	// Hiding the whole filter when there are no tags is right when nothing's selected (there's nothing
	// useful to filter by) -- but if a tag filter is already active in the URL, hiding this would strand
	// the user with no way to clear it back out (e.g. tags got deleted, or this AMA's tags haven't
	// finished loading yet).
	if (!tags?.length && !tagId) {
		return null;
	}

	const selected = tags?.find((tag) => tag.id === tagId);

	const handleSelect = (nextTagId: number | undefined) => {
		setTagParam(nextTagId ? String(nextTagId) : null);
		setIsOpen(false);
	};

	return (
		<div className="relative" ref={ref}>
			<Button
				aria-label="Filter by tag"
				className="h-10 border border-on-secondary px-3 text-sm text-primary dark:border-on-secondary-dark dark:text-primary-dark"
				onPress={() => setIsOpen(!isOpen)}
				type="button"
			>
				{selected ? selected.name : <span className="text-secondary dark:text-secondary-dark">All tags</span>}
				<SvgChevronDown className={cn('transition-transform', isOpen && 'rotate-180')} size={14} />
			</Button>

			{isOpen && (
				<div className="absolute right-0 z-50 mt-1 min-w-full whitespace-nowrap rounded-md border border-on-secondary bg-card shadow-lg dark:border-on-secondary-dark dark:bg-card-dark">
					<Button
						className={cn(
							'w-full justify-start rounded-none px-3 py-2 text-left text-sm',
							!tagId && 'bg-misc-accent/10 text-misc-accent',
						)}
						onPress={() => handleSelect(undefined)}
					>
						All tags
					</Button>
					{tags?.map((tag) => (
						<Button
							className={cn(
								'w-full justify-start rounded-none px-3 py-2 text-left text-sm',
								tag.id === tagId && 'bg-misc-accent/10 text-misc-accent',
							)}
							key={tag.id}
							onPress={() => handleSelect(tag.id)}
						>
							{tag.name}
						</Button>
					))}
				</div>
			)}
		</div>
	);
}
