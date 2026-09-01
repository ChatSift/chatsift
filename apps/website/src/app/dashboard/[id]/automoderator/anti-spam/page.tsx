import { AntiSpamForm } from './_components/AntiSpamForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorAntiSpamPage() {
	return (
		<div className="flex flex-col gap-4">
			<DashboardCrumbs />
			<Heading subtitle="How many messages, how quickly, before it counts as spam" title="Anti-Spam" />
			<AntiSpamForm />
		</div>
	);
}
