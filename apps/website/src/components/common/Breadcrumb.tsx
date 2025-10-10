import Link from 'next/link';
import { BreadcrumbDropdown } from './BreadcrumbDropdown';
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
	readonly label: string;
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
	readonly label: string;
}

function BreadcrumbLabel({ icon, label, href, isLast, highlight }: BreadcrumbLabelProps) {
	const content = (
		<>
			{icon}
			{label}
		</>
	);

	if (href) {
		return (
			<Link
				className={cn(
					'flex items-center gap-2 hover:text-primary dark:hover:text-primary-dark',
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

	return <span className={cn('flex items-center gap-2', getBreadcrumbTextStyles(isLast, highlight))}>{content}</span>;
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
							<BreadcrumbDropdown {...segment} isLast={isLast} options={segment.options} />
						) : (
							<BreadcrumbLabel {...segment} isLast={isLast} />
						)}

						{!isLast && <span className="text-secondary dark:text-secondary-dark">/</span>}
					</div>
				);
			})}
		</nav>
	);
}
