'use client';

import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import type { AMATag } from '@/api/routes/ama';
import { useAMATags, useCreateAMATag } from '@/api/routes/ama';
import { Button } from '@/components/common/Button';
import { useClickOutside } from '@/hooks/useClickOutside';
import { cn } from '@/utils/util';

interface TagPickerProps {
	readonly assignedTagIds: number[];
	onChange(tagIds: number[]): void;
}

/**
 * Click-outside popover with type-to-filter + inline "Create '<name>'" (mechanically modeled on
 * `EmojiInput.tsx`) -- tags are session-scoped and freeform, so creating one inline while tagging a
 * question is the primary way they ever get made (there's no separate "manage tags" screen).
 */
export function TagPicker({ assignedTagIds, onChange }: TagPickerProps) {
	const { id: guildId, amaId } = useParams<{ amaId: string; id: string }>();
	const { data: tags } = useAMATags(guildId, amaId);
	const createTag = useCreateAMATag(guildId, amaId);
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState('');
	const ref = useRef<HTMLDivElement>(null);

	useClickOutside(ref, isOpen, () => setIsOpen(false));

	const assigned = (tags ?? []).filter((tag) => assignedTagIds.includes(tag.id));
	const filtered = (tags ?? []).filter((tag) => tag.name.toLowerCase().includes(query.trim().toLowerCase()));
	const exactMatch = (tags ?? []).some((tag) => tag.name.toLowerCase() === query.trim().toLowerCase());

	const toggleTag = (tag: AMATag) => {
		onChange(
			assignedTagIds.includes(tag.id) ? assignedTagIds.filter((id) => id !== tag.id) : [...assignedTagIds, tag.id],
		);
	};

	const handleCreate = async () => {
		const name = query.trim();
		if (!name) return;

		const tag = await createTag.mutateAsync({ name });
		onChange([...assignedTagIds, tag.id]);
		setQuery('');
	};

	return (
		<div className="relative" ref={ref}>
			<div className="flex flex-wrap items-center gap-1.5">
				{assigned.map((tag) => (
					<span
						className="flex items-center gap-1 rounded-full bg-on-tertiary px-2.5 py-1 text-xs font-medium text-primary dark:bg-on-tertiary-dark dark:text-primary-dark"
						key={tag.id}
					>
						{tag.name}
						<Button
							aria-label={`Remove tag ${tag.name}`}
							className="h-auto bg-transparent px-0 py-0 text-secondary hover:bg-transparent hover:text-primary dark:text-secondary-dark dark:hover:bg-transparent dark:hover:text-primary-dark"
							onPress={() => toggleTag(tag)}
						>
							×
						</Button>
					</span>
				))}
				<Button
					className="h-7 border border-dashed border-on-secondary px-2 text-xs text-secondary dark:border-on-secondary-dark dark:text-secondary-dark"
					onPress={() => setIsOpen(!isOpen)}
					type="button"
				>
					+ Tag
				</Button>
			</div>

			{isOpen && (
				<div className="absolute left-0 z-50 mt-1 w-56 rounded-md border border-on-secondary bg-card p-2 shadow-lg dark:border-on-secondary-dark dark:bg-card-dark">
					<input
						autoFocus
						className="mb-2 w-full rounded-md border border-on-secondary bg-card px-2 py-1.5 text-sm text-primary focus:border-misc-accent focus:outline-none dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search or create a tag..."
						type="text"
						value={query}
					/>
					<div className="max-h-48 space-y-0.5 overflow-y-auto">
						{filtered.map((tag) => (
							<Button
								className={cn(
									'w-full justify-start rounded px-2 py-1.5 text-left text-sm',
									assignedTagIds.includes(tag.id) && 'bg-misc-accent/10 text-misc-accent',
								)}
								key={tag.id}
								onPress={() => toggleTag(tag)}
							>
								{tag.name}
							</Button>
						))}
						{query.trim() && !exactMatch && (
							<Button
								className="w-full justify-start rounded px-2 py-1.5 text-left text-sm text-misc-accent"
								isDisabled={createTag.isPending}
								onPress={handleCreate}
							>
								Create &quot;{query.trim()}&quot;
							</Button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
