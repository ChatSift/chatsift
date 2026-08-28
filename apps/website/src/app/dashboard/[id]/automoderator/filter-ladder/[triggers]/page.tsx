import { EditTriggerPunishmentFormLoader } from '../_components/TriggerPunishmentForm';
import { Heading } from '@/components/common/Heading';
import { DashboardCrumbs } from '@/components/dashboard/DashboardCrumbs';

export default function EditTriggerPunishmentPage() {
	return (
		<div className="flex flex-col [&>*:not(:first-of-type)]:mt-8 [&>*]:first-of-type:mb-4">
			<DashboardCrumbs />
			<Heading subtitle="Edit a filter ladder step" title="Edit Step" />
			<EditTriggerPunishmentFormLoader />
		</div>
	);
}
