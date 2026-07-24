'use client';

import type { APIGuildForumTag } from 'discord-api-types/v10';
import { useRef, useState } from 'react';
import { SvgChevronDown } from '../icons/SvgChevronDown';
import { Button } from './Button';
import { Emoji } from './Emoji';
import { ScrollArea } from './ScrollArea';
import { useClickOutside } from '@/hooks/useClickOutside';
import { cn } from '@/utils/util';

/**
 * A forum tag's emoji is either a custom guild emoji (`emoji_id` set, `emoji_name` is that emoji's name) or a
 * unicode emoji (`emoji_name` set, `emoji_id` null) -- never both. Reuses `Emoji.tsx`'s shorthand parsing by
 * building the same `<:name:id>` string it expects for the custom case, and passing the unicode emoji through
 * as-is otherwise (it renders natively as text).
 */
export function tagEmojiValue(tag: APIGuildForumTag): string | undefined {
	if (tag.emoji_id) {
		return `<:${tag.emoji_name ?? 'tag'}:${tag.emoji_id}>`;
	}

	return tag.emoji_name ?? undefined;
}

interface ForumTagSelectProps {
	readonly error?: string | undefined;
	readonly id: string;
	readonly label: string;
	onChange(tagId: string | undefined): void;
	readonly placeholder?: string;
	readonly required?: boolean;
	readonly tags: APIGuildForumTag[];
	readonly value: string;
}

export function ForumTagSelect({
	id,
	label,
	value,
	onChange,
	tags,
	error,
	placeholder = 'Select a forum tag',
	required = false,
}: ForumTagSelectProps) {
	const [isOpen, setIsOpen] = useState(false);
	const selectRef = useRef<HTMLDivElement>(null);

	const selectedTag = tags.find((tag) => tag.id === value);

	useClickOutside(selectRef, isOpen, () => setIsOpen(false));

	const handleSelect = (tagId: string | undefined) => {
		onChange(tagId);
		setIsOpen(false);
	};

	return (
		<div>
			<label className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2" htmlFor={id}>
				{label} {required && '*'}
			</label>
			<div className="relative" ref={selectRef}>
				<Button
					className={cn(
						'text-base w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent text-left flex items-center justify-between',
						error && 'border-misc-danger focus:ring-misc-danger',
					)}
					id={id}
					onClick={() => setIsOpen(!isOpen)}
					type="button"
				>
					<span className="flex flex-1 items-center gap-1.5 truncate text-sm">
						{selectedTag ? (
							<>
								{tagEmojiValue(selectedTag) && <Emoji className="h-4 w-4 shrink-0" value={tagEmojiValue(selectedTag)!} />}
								{selectedTag.name}
							</>
						) : (
							<span className="text-secondary dark:text-secondary-dark">{placeholder}</span>
						)}
					</span>
					<SvgChevronDown
						className={cn(
							'transition-transform text-secondary dark:text-secondary-dark shrink-0',
							isOpen && 'rotate-180',
						)}
						size={16}
					/>
				</Button>

				{isOpen && (
					<div className="absolute z-50 w-full mt-1 bg-card dark:bg-card-dark border border-on-secondary dark:border-on-secondary-dark rounded-md shadow-lg">
						<ScrollArea className="max-h-80">
							{!required && (
								<Button
									className={cn(
										'w-full px-3 py-2 text-left transition-colors hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark cursor-pointer',
										!value && 'bg-misc-accent/10 text-misc-accent',
									)}
									key="none"
									onClick={() => handleSelect(undefined)}
								>
									<span className="text-sm text-secondary dark:text-secondary-dark">None</span>
								</Button>
							)}
							{tags.length === 0 ? (
								<p className="px-3 py-2 text-sm text-secondary dark:text-secondary-dark">
									This forum has no tags configured on Discord.
								</p>
							) : (
								tags.map((tag) => (
									<Button
										className={cn(
											'w-full px-3 py-2 text-left transition-colors hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark cursor-pointer',
											value === tag.id && 'bg-misc-accent/10 text-misc-accent',
										)}
										key={tag.id}
										onClick={() => handleSelect(tag.id)}
									>
										<span className="flex items-center gap-1.5 truncate text-sm">
											{tagEmojiValue(tag) && <Emoji className="h-4 w-4 shrink-0" value={tagEmojiValue(tag)!} />}
											{tag.name}
										</span>
									</Button>
								))
							)}
						</ScrollArea>
					</div>
				)}
			</div>
			{error && <p className="mt-1 text-sm text-misc-danger">{error}</p>}
		</div>
	);
}
