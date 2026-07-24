import { DashboardCrumbs } from '../../../_components/DashboardCrumbs';
import { PanelsList } from './_components/PanelsList';
import { Heading } from '@/components/common/Heading';

export default function ModmailPanelsPage() {
	return (
		<>
			<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
				<DashboardCrumbs />
				<Heading subtitle="Ticket-creation panels posted in your server" title="ModMail Panels" />
			</div>

			<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
				<PanelsList />
			</div>
		</>
	);
}
