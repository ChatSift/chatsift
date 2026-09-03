import { EditTriggerPunishmentFormLoader } from '../_components/TriggerPunishmentForm';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function EditTriggerPunishmentPage() {
	return (
		<div className="space-y-8">
			<PageHeader subtitle="Edit a filter ladder step" title="Edit Step" />
			<EditTriggerPunishmentFormLoader />
		</div>
	);
}
