'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Image from 'next/image';
import Link from 'next/link';
import type { BreadcrumbOption } from './Breadcrumb';
import { getBreadcrumbTextStyles } from './Breadcrumb';
import { Button } from './Button';
import { SvgChevronDown } from '@/components/icons/SvgChevronDown';
import { cn, getGuildAcronym } from '@/utils/util';

interface BreadcrumbDropdownProps {
	readonly highlight?: boolean | undefined;
	readonly href?: string | undefined;
	readonly icon?: React.ReactNode;
	readonly isLast: boolean;
	readonly label: string;
	readonly options: readonly BreadcrumbOption[];
}

export function BreadcrumbDropdown({ label, icon, href, options, isLast, highlight }: BreadcrumbDropdownProps) {
	const textStyles = getBreadcrumbTextStyles(isLast, highlight);
	const content = (
		<>
			{icon}
			{label}
		</>
	);

	return (
		<div className="flex items-center gap-1">
			{href ? (
				<Link
					className={cn(
						'flex items-center gap-2 hover:text-primary dark:hover:text-primary-dark',
						textStyles,
						isLast && 'pointer-events-none',
					)}
					href={href}
					prefetch
				>
					{content}
				</Link>
			) : (
				<span className={cn('flex items-center gap-2', textStyles)}>{content}</span>
			)}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger asChild>
					<Button className={cn('flex items-center hover:text-primary dark:hover:text-primary-dark px-0', textStyles)}>
						<SvgChevronDown />
					</Button>
				</DropdownMenu.Trigger>

				<DropdownMenu.Portal>
					<DropdownMenu.Content
						className="min-w-[220px] bg-card dark:bg-card-dark border border-on-secondary dark:border-on-secondary-dark rounded-lg p-1 shadow-lg z-50"
						sideOffset={5}
					>
						{options.map((option, optionIndex) => {
							// Handle guild-specific icons (with id and icon properties)
							const iconUrl =
								option.icon && option.id ? `https://cdn.discordapp.com/icons/${option.id}/${option.icon}.png` : null;

							// Check if label has bold markdown (**text**)
							const isBold = option.label.startsWith('**') && option.label.endsWith('**');
							const displayLabel = isBold ? option.label.slice(2, -2) : option.label;

							return (
								<DropdownMenu.Item asChild key={optionIndex}>
									<Link
										className={cn(
											'flex items-center gap-2 px-3 py-2 text-base text-secondary dark:text-secondary-dark hover:text-primary dark:hover:text-primary-dark hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark rounded-md outline-none cursor-pointer',
											isBold && 'font-bold',
										)}
										href={option.href}
										prefetch
									>
										{iconUrl && (
											<Image
												alt={`${displayLabel} icon`}
												className="flex h-6 w-6 items-center justify-center rounded-full"
												height={24}
												src={iconUrl}
												width={24}
											/>
										)}
										{!iconUrl && option.id && (
											<span className="flex h-6 w-6 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-on-tertiary text-xs dark:bg-on-tertiary-dark">
												{getGuildAcronym(displayLabel)}
											</span>
										)}
										{displayLabel}
									</Link>
								</DropdownMenu.Item>
							);
						})}
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		</div>
	);
}
