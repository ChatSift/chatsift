import { Heading } from '@chatsift/web-core/components/Heading';
import { EditPanelFormLoader } from './_components/EditPanelForm';
import { ModmailPanelCrumbs } from '@/components/dashboard/ModmailPanelCrumbs';

export default function EditModmailPanelPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<ModmailPanelCrumbs />
			<Heading subtitle="Edit an existing ticket panel" title="Edit Ticket Panel" />
			<EditPanelFormLoader />
		</div>
	);
}
