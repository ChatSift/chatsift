import type { MarketingFeature } from '@/data/marketingBots';

interface FeatureGridProps {
	readonly features: readonly MarketingFeature[];
}

export function FeatureGrid({ features }: FeatureGridProps) {
	return (
		<ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
			{features.map((feature) => (
				<li
					className="flex flex-col gap-1 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark"
					key={feature.name}
				>
					<p className="font-medium text-primary before:mr-2 before:text-misc-accent before:content-['•'] dark:text-primary-dark">
						{feature.name}
					</p>
					<p className="text-sm text-secondary dark:text-secondary-dark">{feature.description}</p>
				</li>
			))}
		</ul>
	);
}
