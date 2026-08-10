'use client';

import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import type { AMATag } from '@/api/routes/ama';
import { useAMATags, useCreateAMATag, useDeleteAMATag } from '@/api/routes/ama';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { SvgTrash } from '@/components/icons/SvgTrash';
import { useClickOutside } from '@/hooks/useClickOutside';
import { cn } from '@/utils/util';

interface TagPickerProps {
	readonly assignedTagIds: number[];
	onChange(tagIds: number[]): void;
}

/**
 * Click-outside popover with type-to-filter + inline "Create '<name>'" (mechanically modeled on
 * `EmojiInput.tsx`) -- tags are session-scoped and freeform, so creating one inline while tagging a
 * question is the primary way they ever get made. Deleting one lives here too, for the same reason:
 * there's no separate "manage tags" screen, and this is the only place the full session tag list is
 * already in front of someone.
 */
export function TagPicker({ assignedTagIds, onChange }: TagPickerProps) {
	const { id: guildId, amaId } = useParams<{ amaId: string; id: string }>();
	const { data: tags } = useAMATags(guildId, amaId);
	const createTag = useCreateAMATag(guildId, amaId);
	const deleteTag = useDeleteAMATag(guildId, amaId);
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState('');
	// Held here rather than read off the popover, so the modal survives the popover closing underneath it.
	const [pendingDelete, setPendingDelete] = useState<AMATag | null>(null);
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

	// No `onChange` follow-up needed even when the deleted tag was on this question: the assignment rows
	// cascade away server-side, and `useDeleteAMATag` invalidates the question cache `assignedTagIds` is
	// derived from.
	const handleDelete = async () => {
		if (!pendingDelete) return;

		await deleteTag.mutateAsync(pendingDelete.id);
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
						aria-label="Search or create a tag"
						autoFocus
						className="mb-2 w-full rounded-md border border-on-secondary bg-card px-2 py-1.5 text-sm text-primary focus:border-misc-accent focus:outline-none dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search or create a tag..."
						type="text"
						value={query}
					/>
					<div className="max-h-48 space-y-0.5 overflow-y-auto">
						{filtered.map((tag) => (
							// Two sibling buttons rather than a delete nested inside the toggle -- assigning a tag to this
							// question and deleting it from the whole session are very different actions to fat-finger
							// between, and a button inside a button isn't valid markup anyway.
							<div className="flex items-center gap-1" key={tag.id}>
								<Button
									className={cn(
										'min-w-0 flex-1 justify-start rounded px-2 py-1.5 text-left text-sm',
										assignedTagIds.includes(tag.id) && 'bg-misc-accent/10 text-misc-accent',
									)}
									onPress={() => toggleTag(tag)}
								>
									<span className="truncate">{tag.name}</span>
								</Button>
								<Button
									aria-label={`Delete tag ${tag.name}`}
									className="shrink-0 rounded px-1.5 py-1.5 text-sm text-secondary hover:text-misc-danger dark:text-secondary-dark dark:hover:text-misc-danger"
									onPress={() => {
										setIsOpen(false);
										setPendingDelete(tag);
									}}
								>
									<SvgTrash size={14} />
								</Button>
							</div>
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

			{/* Outside the popover's conditional on purpose: pressing delete closes the popover, and this has to
				outlive that. It also means `useClickOutside`'s document listener is already detached by the time the
				modal is on screen, so clicking inside the portaled modal can't read as an outside click. */}
			<ConfirmModal
				confirmLabel="Delete tag"
				isDestructive
				isOpen={pendingDelete !== null}
				onConfirm={handleDelete}
				onOpenChange={(open) => {
					if (!open) setPendingDelete(null);
				}}
				title={`Delete "${pendingDelete?.name}"?`}
			>
				{pendingDelete?.count
					? `It's currently on ${pendingDelete.count} question${pendingDelete.count === 1 ? '' : 's'} in this AMA and will be removed from ${pendingDelete.count === 1 ? 'it' : 'them'}. This can't be undone.`
					: "It isn't on any questions in this AMA. This can't be undone."}
			</ConfirmModal>
		</div>
	);
}
