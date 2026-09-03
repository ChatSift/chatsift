import {
	countByOutcome,
	FEATURE_OUTCOMES,
	featureCountLabel,
	OUTCOME_LABELS,
	OUTCOME_PILL_CLASSES,
} from './featureChanges';
import { cn } from '@/utils/util';

export function OutcomeLegend() {
	return (
		<div className="grid grid-cols-2 gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark sm:grid-cols-5">
			{FEATURE_OUTCOMES.map((outcome) => (
				<div className="flex flex-col items-start gap-1.5" key={outcome}>
					<span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', OUTCOME_PILL_CLASSES[outcome])}>
						{OUTCOME_LABELS[outcome]}
					</span>
					<span className="text-sm text-secondary dark:text-secondary-dark">
						{featureCountLabel(countByOutcome(outcome))}
					</span>
				</div>
			))}
		</div>
	);
}
