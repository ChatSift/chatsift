import Link from 'next/link';
import { BreadcrumbDropdown } from './BreadcrumbDropdown';
import { cn } from '@/utils/util';

export interface BreadcrumbOption {
	readonly href: string;
	readonly label: string;
}

export interface BreadcrumbSegment {
	readonly highlight?: boolean;
	readonly href?: string | undefined;
	readonly label: string;
	readonly options?: readonly BreadcrumbOption[];
}

interface BreadcrumbProps {
	readonly segments: BreadcrumbSegment[];
}

export function Breadcrumb({ segments }: BreadcrumbProps) {
	return (
		<nav className="flex items-center gap-2 text-lg">
			{segments.map((segment, index) => {
				const isLast = index === segments.length - 1;
				const hasOptions = segment.options && segment.options.length > 0;

				return (
					<div className="flex items-center gap-2" key={`${segment.label}-${index}`}>
						{hasOptions ? (
							<BreadcrumbDropdown
								highlight={segment.highlight}
								isLast={isLast}
								label={segment.label}
								options={segment.options}
							/>
						) : segment.href ? (
							<Link
								className={cn(
									'hover:text-primary dark:hover:text-primary-dark',
									isLast
										? 'text-primary dark:text-primary-dark font-medium'
										: 'text-secondary dark:text-secondary-dark',
									isLast && 'pointer-events-none',
									segment.highlight && 'italic',
								)}
								href={segment.href}
								prefetch
							>
								{segment.label}
							</Link>
						) : (
							<span
								className={cn(
									isLast
										? 'text-primary dark:text-primary-dark font-medium'
										: 'text-secondary dark:text-secondary-dark',
									segment.highlight && 'italic',
								)}
							>
								{segment.label}
							</span>
						)}

						{!isLast && <span className="text-secondary dark:text-secondary-dark">/</span>}
					</div>
				);
			})}
		</nav>
	);
}
