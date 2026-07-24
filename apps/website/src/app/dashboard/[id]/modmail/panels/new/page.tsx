import { DashboardCrumbs } from '../../../../_components/DashboardCrumbs';
import { RefreshServerDataButton } from '../../../ama/amas/new/_components/RefreshServerDataButton';
import { CreatePanelForm } from './_components/CreatePanelForm';
import { Heading } from '@/components/common/Heading';

export default function NewModmailPanelPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
				<Heading subtitle="Post a new ticket panel in your server" title="New Ticket Panel" />
				<RefreshServerDataButton for_bot="MODMAIL" />
			</div>
			<CreatePanelForm />
		</div>
	);
}
