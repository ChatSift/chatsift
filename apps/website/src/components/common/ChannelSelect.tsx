'use client';

import type { GuildChannelInfo } from '@chatsift/api';
import { sortChannels } from '@chatsift/discord-utils';
import { ChannelType } from 'discord-api-types/v10';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SvgChevronDown } from '../icons/SvgChevronDown';
import { Button } from './Button';
import { ScrollArea } from './ScrollArea';
import { getChannelIcon } from '@/utils/channels';
import { cn } from '@/utils/util';

interface ChannelSelectProps {
	readonly allowedTypes: ChannelType[];
	readonly channels: GuildChannelInfo[];
	readonly error?: string | undefined;
	readonly label: string;
	onChange(channelId: string | undefined): void;
	readonly placeholder?: string;
	readonly required?: boolean;
	readonly selectedId: string;
	readonly value: string;
}

export const threadTypes = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread];

export function ChannelSelect({
	selectedId,
	label,
	value,
	onChange,
	channels,
	error,
	placeholder = 'Select a channel',
	required = false,
	allowedTypes,
}: ChannelSelectProps) {
	const [isOpen, setIsOpen] = useState(false);
	const selectRef = useRef<HTMLDivElement>(null);

	const sortedChannels = sortChannels(channels);
	const selectedChannel = channels.find((ch) => ch.id === value);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
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

	const handleSelect = (channelId: string | undefined, isSelectable: boolean) => {
		if (!isSelectable) return;
		onChange(channelId);
		setIsOpen(false);
	};

	const handleNoneSelect = () => {
		onChange(undefined);
		setIsOpen(false);
	};

	return (
		<div>
			<label className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2" htmlFor={selectedId}>
				{label} {required && '*'}
			</label>
			<div className="relative" ref={selectRef}>
				<Button
					className={cn(
						'text-base w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent text-left flex items-center justify-between',
						error && 'border-misc-danger focus:ring-misc-danger',
					)}
					id={selectedId}
					onClick={() => setIsOpen(!isOpen)}
					type="button"
				>
					<span className="flex items-center gap-2 flex-1 min-w-0">
						{selectedChannel ? (
							<ChannelItem channel={selectedChannel} />
						) : (
							<span className="text-secondary dark:text-secondary-dark">{placeholder}</span>
						)}
					</span>
					<SvgChevronDown
						className={cn(
							'transition-transform text-secondary dark:text-secondary-dark flex-shrink-0',
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
									onClick={handleNoneSelect}
								>
									<span className="text-sm text-secondary dark:text-secondary-dark">None</span>
								</Button>
							)}
							{sortedChannels.map((channel: GuildChannelInfo) => {
								const isCategory = channel.type === ChannelType.GuildCategory;
								const isParentToAllowed = channels.some(
									(ch) => ch.parent_id === channel.id && allowedTypes.includes(ch.type),
								);
								const isThread = threadTypes.includes(channel.type);
								const hasParent = channel.parent_id !== null && channel.parent_id !== undefined;

								// Determine if this channel matches the allowed types
								const isAllowedType = allowedTypes.includes(channel.type);
								const shouldDisplay = isParentToAllowed || isAllowedType;

								// Determine if this channel is selectable
								const isSelectable = !isCategory && isAllowedType;

								if (!shouldDisplay) {
									return null;
								}

								// Categories are always displayed but not selectable
								if (isCategory) {
									return (
										<div
											className="px-3 py-2 text-xs font-semibold text-secondary dark:text-secondary-dark uppercase tracking-wide bg-on-tertiary dark:bg-on-tertiary-dark"
											key={channel.id}
										>
											<ChannelItem channel={channel} />
										</div>
									);
								}

								return (
									<Button
										className={cn(
											'w-full px-3 py-2 text-left transition-colors',
											isSelectable && 'hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark cursor-pointer',
											!isSelectable && 'cursor-not-allowed opacity-50',
											value === channel.id && isSelectable && 'bg-misc-accent/10 text-misc-accent',
											isThread && 'pl-8',
											!isThread && hasParent && 'pl-6',
										)}
										isDisabled={!isSelectable}
										key={channel.id}
										onClick={() => handleSelect(channel.id, isSelectable)}
									>
										<ChannelItem channel={channel} />
									</Button>
								);
							})}
						</ScrollArea>
					</div>
				)}
			</div>
			{error && <p className="mt-1 text-sm text-misc-danger">{error}</p>}
		</div>
	);
}

interface ChannelItemProps {
	readonly channel: GuildChannelInfo;
}

function ChannelItem({ channel }: ChannelItemProps) {
	const Icon = getChannelIcon(channel.type);
	return (
		<div className="flex items-center gap-2 min-w-0">
			<Icon className="flex-shrink-0 text-secondary dark:text-secondary-dark" size={16} />
			<span className="truncate text-sm">{channel.name}</span>
		</div>
	);
}
