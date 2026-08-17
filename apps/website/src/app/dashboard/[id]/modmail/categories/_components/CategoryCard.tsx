'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ModmailCategory } from '@/api/routes/modmail';
import { useDeleteModmailCategory, useModForumTags, useModmailConfig, useModmailPanels } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Emoji } from '@/components/common/Emoji';
import { tagEmojiValue } from '@/components/common/ForumTagSelect';
import { SvgChevronDown } from '@/components/icons/SvgChevronDown';

interface CategoryCardProps {
	readonly canMoveDown: boolean;
	readonly canMoveUp: boolean;
	readonly category: ModmailCategory;
	readonly guildId: string;
	onMoveDown(): void;
	onMoveUp(): void;
}

export function CategoryCard({ guildId, category, canMoveUp, canMoveDown, onMoveUp, onMoveDown }: CategoryCardProps) {
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const deleteCategory = useDeleteModmailCategory(guildId);
	const { data: config } = useModmailConfig(guildId);
	const { tags: forumTags } = useModForumTags(guildId);
	// Only read for the delete confirmation's copy: `ticket_panel_categories` cascades on category delete, so
	// deleting this quietly rewrites every panel offering it. React Query dedupes the fetch across every card.
	const { data: panels } = useModmailPanels(guildId);

	const panelsOfferingCount = panels?.filter((panel) => panel.categoryIds.includes(category.id)).length ?? 0;

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					{category.emoji && <Emoji className="h-7 w-7 shrink-0 text-2xl" value={category.emoji} />}
					<p className="truncate text-xl font-semibold text-primary dark:text-primary-dark">{category.name}</p>
				</div>

				<div className="flex shrink-0 flex-col gap-0.5">
					<Button aria-label="Move up" className="p-1" isDisabled={!canMoveUp} onPress={onMoveUp} type="button">
						<SvgChevronDown className="rotate-180" size={16} />
					</Button>
					<Button aria-label="Move down" className="p-1" isDisabled={!canMoveDown} onPress={onMoveDown} type="button">
						<SvgChevronDown size={16} />
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-3">
				<div>
					<p className="text-xs font-semibold uppercase tracking-wide text-secondary/70 dark:text-secondary-dark/70">
						Description
					</p>
					<p className="text-sm text-primary dark:text-primary-dark">
						{category.description || <span className="italic text-secondary dark:text-secondary-dark">Not set</span>}
					</p>
				</div>

				<div>
					<p className="text-xs font-semibold uppercase tracking-wide text-secondary/70 dark:text-secondary-dark/70">
						Greeting Message
					</p>
					<p className="text-sm text-primary dark:text-primary-dark">
						{category.greetingMessage || (
							<span className="italic text-secondary dark:text-secondary-dark">
								Falls back to the{' '}
								<Link className="underline hover:text-misc-accent" href={`/dashboard/${guildId}/modmail/config`}>
									guild default
								</Link>
							</span>
						)}
					</p>
				</div>

				<div>
					<p className="text-xs font-semibold uppercase tracking-wide text-secondary/70 dark:text-secondary-dark/70">
						Forum Tag
					</p>
					<p className="flex items-center gap-1.5 text-sm text-primary dark:text-primary-dark">
						{category.forumTagId ? (
							(() => {
								const matchedTag = forumTags?.find((tag) => tag.id === category.forumTagId);
								const emojiValue = matchedTag && tagEmojiValue(matchedTag);
								return (
									<>
										{emojiValue && <Emoji className="h-4 w-4 shrink-0" value={emojiValue} />}
										{matchedTag?.name ?? `Unknown tag (${category.forumTagId})`}
									</>
								);
							})()
						) : (
							<span className="italic text-secondary dark:text-secondary-dark">Not set</span>
						)}
					</p>
				</div>

				<div>
					<p className="text-xs font-semibold uppercase tracking-wide text-secondary/70 dark:text-secondary-dark/70">
						Max Concurrent Threads
					</p>
					<p className="text-sm text-primary dark:text-primary-dark">
						{category.maxConcurrentThreads ?? (
							<span className="italic text-secondary dark:text-secondary-dark">
								Guild default{config ? ` (${config.maxConcurrentThreads})` : ''}
							</span>
						)}
					</p>
				</div>
			</div>

			<div className="mt-auto flex justify-end gap-2">
				<Link
					className="flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 text-lg text-primary hover:bg-on-tertiary active:bg-on-secondary dark:text-primary-dark dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark"
					href={`/dashboard/${guildId}/modmail/categories/${category.id}`}
				>
					Edit
				</Link>
				<Button onPress={() => setIsConfirmOpen(true)}>
					<span className="text-misc-danger">Delete</span>
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Delete category"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => deleteCategory.mutateAsync(category.id)}
				onOpenChange={setIsConfirmOpen}
				title={`Delete "${category.name}"?`}
			>
				{panelsOfferingCount > 0
					? `It's offered by ${panelsOfferingCount} panel${panelsOfferingCount === 1 ? '' : 's'} and will be removed from ${panelsOfferingCount === 1 ? 'it' : 'them'}. `
					: 'No panel currently offers it. '}
				Nobody will be able to pick it when opening a thread anymore. Threads already opened under it stay where they
				are, but stop counting as belonging to any category. This can&apos;t be undone.
			</ConfirmModal>
		</div>
	);
}
