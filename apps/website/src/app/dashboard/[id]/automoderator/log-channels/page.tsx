import { LogChannelsForm } from './_components/LogChannelsForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function AutomoderatorLogChannelsPage() {
	return (
		<div className="flex flex-col gap-4">
			<DashboardCrumbs />
			<Heading subtitle="Where moderation actions are posted" title="Log Channels" />
			<LogChannelsForm />
		</div>
	);
}
