'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BreadcrumbDropdown } from './BreadcrumbDropdown';
import { SvgChevronDown } from '@/components/icons/SvgChevronDown';
import { cn } from '@/utils/util';

export interface BreadcrumbOption {
	readonly href: string;
	readonly icon?: string | null;
	readonly id?: string;
	readonly label: string;
}

export interface BreadcrumbSegment {
	readonly highlight?: boolean;
	readonly href?: string | undefined;
	readonly icon?: React.ReactNode;
	readonly label: React.ReactNode;
	readonly options?: readonly BreadcrumbOption[];
}

interface BreadcrumbProps {
	readonly segments: BreadcrumbSegment[];
}

export function getBreadcrumbTextStyles(isLast: boolean, highlight?: boolean) {
	return cn(
		isLast ? 'text-primary dark:text-primary-dark font-medium' : 'text-secondary dark:text-secondary-dark',
		highlight && 'italic',
	);
}

interface BreadcrumbLabelProps {
	readonly highlight?: boolean;
	readonly href?: string | undefined;
	readonly icon?: React.ReactNode;
	readonly isLast: boolean;
	readonly label: React.ReactNode;
}

function BreadcrumbLabel({ icon, label, href, isLast, highlight }: BreadcrumbLabelProps) {
	const content = (
		<>
			{icon}
			<span className="truncate">{label}</span>
		</>
	);

	if (href) {
		return (
			<Link
				className={cn(
					'flex items-center gap-2 hover:text-primary dark:hover:text-primary-dark min-w-0',
					getBreadcrumbTextStyles(isLast, highlight),
					isLast && 'pointer-events-none',
				)}
				href={href}
				prefetch
			>
				{content}
			</Link>
		);
	}

	return (
		<span className={cn('flex items-center gap-2 min-w-0', getBreadcrumbTextStyles(isLast, highlight))}>{content}</span>
	);
}

export function Breadcrumb({ segments }: BreadcrumbProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	// On mobile, show only the last 2 segments by default
	const shouldCollapse = segments.length > 3;
	const hiddenCount = shouldCollapse && !isExpanded ? segments.length - 2 : 0;

	return (
		<nav className="flex items-center gap-2 text-base sm:text-lg overflow-hidden">
			{hiddenCount > 0 && (
				<>
					<button
						className="flex items-center gap-1 text-secondary dark:text-secondary-dark hover:text-primary dark:hover:text-primary-dark transition-colors sm:hidden"
						onClick={() => setIsExpanded(true)}
						type="button"
					>
						<SvgChevronDown className="rotate-90" />
						<span className="text-sm">+{hiddenCount}</span>
					</button>
					<span className="text-secondary dark:text-secondary-dark sm:hidden">/</span>
				</>
			)}

			{segments.map((segment, index) => {
				const isLast = index === segments.length - 1;
				const hasOptions = segment.options && segment.options.length > 0;
				const isHiddenOnMobile = shouldCollapse && !isExpanded && index < segments.length - 2;

				return (
					<div className={cn('flex items-center gap-2 min-w-0', isHiddenOnMobile && 'hidden sm:flex')} key={index}>
						{hasOptions ? (
							<BreadcrumbDropdown {...segment} isLast={isLast} options={segment.options} />
						) : (
							<BreadcrumbLabel {...segment} isLast={isLast} />
						)}

						{!isLast && <span className="text-secondary dark:text-secondary-dark flex-shrink-0">/</span>}
					</div>
				);
			})}
		</nav>
	);
}
