import Link from 'next/link';
import { cn } from '@/utils/util';

export interface BreadcrumbSegment {
	readonly highlight?: boolean;
	readonly href?: string;
	readonly label: string;
}

interface BreadcrumbProps {
	readonly segments: BreadcrumbSegment[];
}

export function Breadcrumb({ segments }: BreadcrumbProps) {
	return (
		<nav className="flex items-center gap-2 text-lg">
			{segments.map((segment, index) => {
				const isLast = index === segments.length - 1;

				return (
					<div className="flex items-center gap-2" key={`${segment.label}-${index}`}>
						{segment.href ? (
							<Link
								className={cn(
									'hover:text-primary dark:hover:text-primary-dark',
									isLast
										? 'text-primary dark:text-primary-dark font-medium'
										: 'text-secondary dark:text-secondary-dark',
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
