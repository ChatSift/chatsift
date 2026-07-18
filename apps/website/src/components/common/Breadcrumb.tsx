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

	if (href && !isLast) {
		return (
			<Link
				className={cn(
					'flex items-center gap-2 hover:text-primary dark:hover:text-primary-dark min-w-0',
					getBreadcrumbTextStyles(isLast, highlight),
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

	// Below `lg:` (1024px) — phone and tablet widths alike — show only the last 2 segments by default; a full
	// 4-5 segment trail (as `DashboardCrumbs`/`AMADashboardCrumbs` produce) doesn't fit legibly until desktop.
	const shouldCollapse = segments.length > 3;
	const hiddenCount = shouldCollapse && !isExpanded ? segments.length - 2 : 0;

	return (
		<nav className="flex items-center gap-2 text-base sm:text-lg overflow-hidden">
			{hiddenCount > 0 && (
				<>
					<button
						className="flex items-center gap-1 text-secondary dark:text-secondary-dark hover:text-primary dark:hover:text-primary-dark transition-colors lg:hidden"
						onClick={() => setIsExpanded(true)}
						type="button"
					>
						<SvgChevronDown className="rotate-90" />
						<span className="text-sm">+{hiddenCount}</span>
					</button>
					<span className="text-secondary dark:text-secondary-dark lg:hidden">/</span>
				</>
			)}

			{segments.map((segment, index) => {
				const isLast = index === segments.length - 1;
				const hasOptions = segment.options && segment.options.length > 0;
				const isHiddenOnMobile = shouldCollapse && !isExpanded && index < segments.length - 2;

				return (
					<div className={cn('flex items-center gap-2 min-w-0', isHiddenOnMobile && 'hidden lg:flex')} key={index}>
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
