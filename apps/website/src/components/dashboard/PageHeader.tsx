import type { ReactNode } from 'react';
import { DashboardCrumbs } from './DashboardCrumbs';
import { Heading } from '@/components/common/Heading';

interface PageHeaderProps {
	/**
	 * A control belonging to the page as a whole rather than to any one form on it -- in practice
	 * `RefreshServerDataButton`. Sits beside the title on desktop and wraps under it on mobile.
	 */
	readonly action?: ReactNode;
	/**
	 * Overrides the default `DashboardCrumbs`, for a page whose trail needs data fetched to name its last
	 * segment (`AutomoderatorReportPromptCrumbs` and friends).
	 */
	readonly crumbs?: ReactNode;
	readonly subtitle?: string;
	readonly title: string;
}

/**
 * The crumbs-plus-title block every dashboard page opens with.
 *
 * Extracted while regrouping AutoModerator (#378): its pages had drifted into two different spellings of this
 * block -- `flex flex-col gap-4` on some, an arbitrary-variant `[&>*:not(:first-of-type)]:mt-8` on others -- so
 * the gap between the heading and the first card was 16px on one page and 48px on the next. Wrap the rest of
 * the page in `space-y-8` alongside it, which is what ModMail's and Social's config pages already do.
 */
export function PageHeader({ title, subtitle, action, crumbs }: PageHeaderProps) {
	return (
		<div className="flex flex-col gap-4">
			{crumbs ?? <DashboardCrumbs />}
			{action ? (
				<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
					<Heading subtitle={subtitle} title={title} />
					{action}
				</div>
			) : (
				<Heading subtitle={subtitle} title={title} />
			)}
		</div>
	);
}
