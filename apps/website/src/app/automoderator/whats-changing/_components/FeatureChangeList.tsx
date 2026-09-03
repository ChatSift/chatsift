import type { FeatureChangeGroup } from './featureChanges';
import { OUTCOME_LABELS, OUTCOME_PILL_CLASSES } from './featureChanges';
import { cn } from '@/utils/util';

/**
 * One group of features as a single card of rows rather than a card each: thirty-seven separate cards is a
 * page you scroll past, and the outcome pill is only comparable when the rows share edges.
 */
export function FeatureChangeList({ group }: { readonly group: FeatureChangeGroup }) {
	return (
		<ul className="rounded-lg border border-on-secondary bg-card dark:border-on-secondary-dark dark:bg-card-dark">
			{group.features.map((feature) => (
				<li
					className="flex flex-col gap-1 border-t border-on-secondary p-4 first:border-t-0 dark:border-on-secondary-dark"
					key={feature.name}
				>
					<div className="flex flex-wrap items-center gap-2">
						<h3
							className={cn(
								'text-base font-medium',
								feature.outcome === 'RETIRED'
									? 'text-secondary dark:text-secondary-dark'
									: 'text-primary dark:text-primary-dark',
							)}
						>
							{feature.name}
						</h3>
						<span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', OUTCOME_PILL_CLASSES[feature.outcome])}>
							{OUTCOME_LABELS[feature.outcome]}
						</span>
					</div>
					<p className="text-sm text-secondary dark:text-secondary-dark">{feature.note}</p>
				</li>
			))}
		</ul>
	);
}
