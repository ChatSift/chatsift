'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { Emoji } from './Emoji';
import { ScrollArea } from './ScrollArea';
import type { GuildEmojiInfo } from '@/api/routes/guilds';
import { cn } from '@/utils/util';

interface EmojiInputProps {
	readonly emojis: GuildEmojiInfo[];
	readonly error?: string | undefined;
	readonly id: string;
	readonly label: string;
	onChange(value: string): void;
	readonly placeholder?: string;
	readonly value: string;
}

/**
 * The shorthand Discord itself uses in message content (`<:name:id>` / `<a:name:id>` for animated) -- stored
 * as-is in `Category.emoji` (a plain string column) so it round-trips without the bot needing to re-resolve it.
 */
function emojiShorthand(emoji: GuildEmojiInfo): string {
	return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

/**
 * A plain text field (for typing/pasting a unicode emoji directly) paired with a picker button listing the
 * guild's custom emojis -- picking one overwrites the field with that emoji's `<:name:id>` shorthand. A category
 * can only carry one emoji, so picking always replaces rather than inserts.
 */
export function EmojiInput({ id, label, value, onChange, emojis, error, placeholder }: EmojiInputProps) {
	const [isOpen, setIsOpen] = useState(false);
	const pickerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
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

	const selectedCustomEmoji = emojis.find((emoji) => emojiShorthand(emoji) === value);

	return (
		<div>
			<label className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark" htmlFor={id}>
				{label}
			</label>
			<div className="flex items-center gap-2">
				<input
					className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
					id={id}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					type="text"
					value={value}
				/>

				<div className="relative shrink-0" ref={pickerRef}>
					<Button
						className="flex h-[42px] w-[42px] items-center justify-center rounded-md border border-on-secondary bg-card text-lg dark:border-on-secondary-dark dark:bg-card-dark"
						onPress={() => setIsOpen(!isOpen)}
						type="button"
					>
						{selectedCustomEmoji ? (
							<Emoji className="h-5 w-5" value={emojiShorthand(selectedCustomEmoji)} />
						) : (
							'🙂'
						)}
					</Button>

					{isOpen && (
						<div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-on-secondary bg-card shadow-lg dark:border-on-secondary-dark dark:bg-card-dark">
							<ScrollArea className="max-h-64">
								{emojis.length === 0 ? (
									<p className="p-3 text-sm text-secondary dark:text-secondary-dark">
										This server has no custom emojis.
									</p>
								) : (
									<div className="grid grid-cols-6 gap-1 p-2">
										{emojis.map((emoji) => (
											<Button
												className={cn(
													'flex h-9 w-9 items-center justify-center rounded hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark',
													value === emojiShorthand(emoji) && 'bg-misc-accent/10',
												)}
												key={emoji.id}
												onPress={() => {
													onChange(emojiShorthand(emoji));
													setIsOpen(false);
												}}
												type="button"
											>
												<Emoji className="h-6 w-6" value={emojiShorthand(emoji)} />
											</Button>
										))}
									</div>
								)}
							</ScrollArea>
						</div>
					)}
				</div>
			</div>
			{error && <p className="mt-1 text-sm text-misc-danger">{error}</p>}
		</div>
	);
}
