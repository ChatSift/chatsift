'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import type { BreadcrumbOption } from './Breadcrumb';
import { Button } from './Button';
import { SvgChevronDown } from '@/components/icons/SvgChevronDown';
import { cn } from '@/utils/util';

interface BreadcrumbDropdownProps {
	readonly highlight?: boolean | undefined;
	readonly isLast: boolean;
	readonly label: string;
	readonly options: readonly BreadcrumbOption[];
}

export function BreadcrumbDropdown({ label, options, isLast, highlight }: BreadcrumbDropdownProps) {
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<Button
					className={cn(
						'flex items-center gap-1 hover:text-primary dark:hover:text-primary-dark px-0',
						isLast ? 'text-primary dark:text-primary-dark font-medium' : 'text-secondary dark:text-secondary-dark',
						highlight && 'italic',
					)}
				>
					{label}
					<SvgChevronDown />
				</Button>
			</DropdownMenu.Trigger>

			<DropdownMenu.Portal>
				<DropdownMenu.Content
					className="min-w-[220px] bg-card dark:bg-card-dark border border-on-secondary dark:border-on-secondary-dark rounded-lg p-1 shadow-lg z-50"
					sideOffset={5}
				>
					{options.map((option, optionIndex) => (
						<DropdownMenu.Item asChild key={optionIndex}>
							<Link
								className="flex items-center px-3 py-2 text-base text-secondary dark:text-secondary-dark hover:text-primary dark:hover:text-primary-dark hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark rounded-md outline-none cursor-pointer"
								href={option.href}
								prefetch
							>
								{option.label}
							</Link>
						</DropdownMenu.Item>
					))}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
