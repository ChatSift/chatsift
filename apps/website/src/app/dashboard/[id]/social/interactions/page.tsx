import { ResyncInteractionsCard } from './_components/ResyncInteractionsCard';
import { SocialInteractionsList } from './_components/SocialInteractionsList';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function SocialInteractionsPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				{/* No inert banner here, unlike the other Social pages: interactions are plain slash commands and
				    work whether or not XP tracking is on. */}
				<Heading subtitle="Custom slash commands like /hug anyone can use" title="Social Interactions" />
			</div>

			<div className="mt-8 grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
				<ResyncInteractionsCard />
				<SocialInteractionsList />
			</div>
		</>
	);
}
