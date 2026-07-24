import { DashboardCrumbs } from '../../../../_components/DashboardCrumbs';
import { EditPanelFormLoader } from './_components/EditPanelForm';
import { Heading } from '@/components/common/Heading';

export default function EditModmailPanelPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<Heading subtitle="Edit an existing ticket panel" title="Edit Ticket Panel" />
			<EditPanelFormLoader />
		</div>
	);
}
